import { configRead } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import { applyAdCleanup, applyBrowseAdFiltering, applyShortsAdFiltering } from './adCleanup.js';
import { PatchSettings } from '../ui/customYTSettings.js';

function getVideoId(item) {
  return item?.tileRenderer?.contentId ||
    item?.videoRenderer?.videoId ||
    item?.playlistVideoRenderer?.videoId ||
    item?.gridVideoRenderer?.videoId ||
    item?.compactVideoRenderer?.videoId ||
    item?.richItemRenderer?.content?.videoRenderer?.videoId ||
    null;
}

function getVideoTitle(item) {
  return (
    item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.playlistVideoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText ||
    item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text ||
    ''
  );
}

function collectVideoIdsFromShelf(shelf) {
  const ids = [];
  const seen = new Set();
  const pushFrom = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      const id = getVideoId(item);
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });
  };

  pushFrom(shelf?.shelfRenderer?.content?.horizontalListRenderer?.items);
  pushFrom(shelf?.shelfRenderer?.content?.gridRenderer?.items);
  pushFrom(shelf?.shelfRenderer?.content?.verticalListRenderer?.items);
  pushFrom(shelf?.richShelfRenderer?.content?.richGridRenderer?.contents);
  pushFrom(shelf?.gridRenderer?.items);

  // Fallback: recurse through shelf object to catch Tizen 5.5 variants where
  // Shorts shelf videos are rendered in non-standard branches.
  const stack = [shelf];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const entry of node) stack.push(entry);
      continue;
    }

    const id = getVideoId(node);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }

    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        stack.push(node[key]);
      }
    }
  }

  return ids;
}

function isLikelyPlaylistHelperItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.continuationItemRenderer) return true;
  if (item?.tileRenderer?.onSelectCommand?.continuationCommand) return true;
  if (item?.tileRenderer?.onSelectCommand?.continuationEndpoint) return true;
  if (item?.continuationEndpoint || item?.continuationCommand) return true;

  const videoId = getVideoId(item);
  if (videoId) return false;

  const textParts = getVideoTitle(item).toLowerCase();

  return /scroll|weiter|weiteres|mehr|more|helper|continuation|fortsetzen|laden/.test(textParts);
}


function getVideoKey(item) {
  const id = getVideoId(item);
  const title = item?.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText ||
    item?.videoRenderer?.title?.runs?.[0]?.text ||
    item?.gridVideoRenderer?.title?.runs?.[0]?.text ||
    item?.compactVideoRenderer?.title?.simpleText || '';
  return `${id || 'unknown'}|${title}`;
}

function trackRemovedPlaylistHelperKeys(helperVideos) {
  window._playlistRemovedHelperKeys = window._playlistRemovedHelperKeys || new Set();
  window._playlistRemovedHelperKeyQueue = window._playlistRemovedHelperKeyQueue || [];

  helperVideos.forEach((video) => {
    const key = getVideoKey(video);
    if (!key || key === 'unknown|') return;
    if (!window._playlistRemovedHelperKeys.has(key)) {
      window._playlistRemovedHelperKeys.add(key);
      window._playlistRemovedHelperKeyQueue.push(key);
    }
  });

  const MAX_KEYS = 40;
  while (window._playlistRemovedHelperKeyQueue.length > MAX_KEYS) {
    const oldest = window._playlistRemovedHelperKeyQueue.shift();
    window._playlistRemovedHelperKeys.delete(oldest);
  }
}

const PLAYLIST_PAGES = new Set(['playlist', 'playlists']);
const SHORTS_FILTER_EXCLUDED_PAGES = PLAYLIST_PAGES;

function isPlaylistPage(page) {
  return PLAYLIST_PAGES.has(page);
}

function initShortsTrackingState() {
  window._shortsVideoIdsFromShelves = window._shortsVideoIdsFromShelves || new Set();
  window._shortsTitlesFromShelves = window._shortsTitlesFromShelves || new Set();
}

function shouldFilterShorts(shortsEnabled, page) {
  return !shortsEnabled && !SHORTS_FILTER_EXCLUDED_PAGES.has(page);
}

function isShortsShelfTitle(title = '') {
  const normalizedTitle = String(title).toLowerCase();
  return normalizedTitle.includes('short');
}

function titleText(title) {
  if (!title) return '';
  if (title.simpleText) return title.simpleText;
  if (Array.isArray(title.runs)) return title.runs.map((run) => run.text).join('');
  return '';
}

function getShelfTitle(shelf) {
  const titlePaths = [
    shelf?.shelfRenderer?.shelfHeaderRenderer?.title,
    shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.title,
    shelf?.shelfRenderer?.title,
    shelf?.headerRenderer?.shelfHeaderRenderer?.title,
    shelf?.richShelfRenderer?.title,
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title,
    shelf?.gridRenderer?.header?.gridHeaderRenderer?.title,
    shelf?.shelfRenderer?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title,
    shelf?.headerRenderer?.shelfHeaderRenderer?.avatarLockup?.avatarLockupRenderer?.title,
  ];

  for (const rawTitle of titlePaths) {
    const text = titleText(rawTitle);
    if (text) return text;
  }

  return '';
}

function rememberShortsFromShelf(shelf, collectIds = collectVideoIdsFromShelf, readTitle = getVideoTitle) {
  initShortsTrackingState();
  const ids = collectIds(shelf);
  ids.forEach((id) => window._shortsVideoIdsFromShelves.add(id));

  const stack = [shelf];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      node.forEach((entry) => stack.push(entry));
      continue;
    }

    const itemTitle = readTitle(node).trim().toLowerCase();
    if (itemTitle) window._shortsTitlesFromShelves.add(itemTitle);

    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        stack.push(node[key]);
      }
    }
  }

  return ids;
}

function isKnownShortFromShelfMemory(item, getId = getVideoId, getTitle = getVideoTitle) {
  const id = getId(item);
  if (id && id !== 'unknown' && window._shortsVideoIdsFromShelves?.has(id)) return true;

  const title = getTitle(item).trim().toLowerCase();
  return !!title && !!window._shortsTitlesFromShelves?.has(title);
}

function removeShortsShelvesByTitle(shelves, { page, shortsEnabled, collectVideoIdsFromShelf: collectIds = collectVideoIdsFromShelf, getVideoTitle: readTitle = getVideoTitle, debugEnabled = false, logShorts = false, path = '' } = {}) {
  if (!Array.isArray(shelves) || shortsEnabled) return 0;
  initShortsTrackingState();

  let removed = 0;
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    const shelfTitle = getShelfTitle(shelf);
    if (!isShortsShelfTitle(shelfTitle)) continue;

    const ids = rememberShortsFromShelf(shelf, collectIds, readTitle);
    if (debugEnabled || logShorts) {
      console.log('[SHORTS_SHELF] removed title=', shelfTitle, '| ids=', ids.length, '| page=', page, '| path=', path || i);
    }
    shelves.splice(i, 1);
    removed++;
  }

  return removed;
}

function isShortItem(item, { debugEnabled = false, logShorts = false, currentPage = '' } = {}) {
  if (!item) return false;

  const videoId = getVideoId(item) || 'unknown';
  const page = currentPage || 'other';

  if ((page === 'subscriptions' || String(page).includes('channel')) && debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] checking', videoId);
  }

  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') return true;

  const overlayHasShortsBadge = (overlays = []) => overlays.some((overlay) =>
    overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
    overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
    overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some((run) => run.text === 'SHORTS')
  );

  const hasShortsUrlOrEndpoint = (renderer) => {
    const navEndpoint = renderer?.navigationEndpoint;
    if (navEndpoint?.reelWatchEndpoint) return true;
    const url = navEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    return url.includes('/shorts/');
  };

  if (item.videoRenderer) {
    if (overlayHasShortsBadge(item.videoRenderer.thumbnailOverlays || [])) return true;
    if (hasShortsUrlOrEndpoint(item.videoRenderer)) return true;
  }

  if (item.gridVideoRenderer) {
    if (overlayHasShortsBadge(item.gridVideoRenderer.thumbnailOverlays || [])) return true;
    if (hasShortsUrlOrEndpoint(item.gridVideoRenderer)) return true;
  }

  if (item.compactVideoRenderer) {
    if (overlayHasShortsBadge(item.compactVideoRenderer.thumbnailOverlays || [])) return true;
    if (hasShortsUrlOrEndpoint(item.compactVideoRenderer)) return true;
  }

  if (item.tileRenderer?.onSelectCommand?.reelWatchEndpoint) return true;

  if (item.tileRenderer?.onSelectCommand) {
    const cmdStr = JSON.stringify(item.tileRenderer.onSelectCommand);
    if (cmdStr.includes('reelWatch') || cmdStr.includes('/shorts/')) return true;
  }

  if (overlayHasShortsBadge(item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays || [])) return true;

  const videoTitle = item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || '';
  if (videoTitle.toLowerCase().includes('#short')) return true;

  if (item.tileRenderer) {
    let lengthText = null;
    const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (Array.isArray(thumbnailOverlays)) {
      const timeOverlay = thumbnailOverlays.find((o) => o.thumbnailOverlayTimeStatusRenderer);
      if (timeOverlay) lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
    }

    if (!lengthText) {
      lengthText = item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
        (lineItem) => lineItem.lineItemRenderer?.badge || lineItem.lineItemRenderer?.text?.simpleText
      )?.lineItemRenderer?.text?.simpleText;
    }

    if (lengthText) {
      const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
      if (durationMatch) {
        const totalSeconds = (parseInt(durationMatch[1], 10) * 60) + parseInt(durationMatch[2], 10);
        if (totalSeconds <= 180) {
          if (debugEnabled && logShorts) {
            console.log('[SHORTS] Detected by duration (≤ 180s):', videoId, '| Duration:', `${totalSeconds}s`);
          }
          return true;
        }
      }
    }
  }

  if (item.richItemRenderer?.content?.reelItemRenderer) return true;

  const thumbnail = item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0];
  if (thumbnail && thumbnail.height > thumbnail.width) return true;

  if (debugEnabled && logShorts) console.log('[SHORTS_DIAGNOSTIC] not short', videoId);
  return false;
}

function filterShortItems(items, { page, debugEnabled = false, logShorts = false } = {}) {
  if (!Array.isArray(items)) return { items: [], removed: 0 };
  const filtered = items.filter((item) => !isShortItem(item, { debugEnabled, logShorts, currentPage: page || 'other' }));
  return { items: filtered, removed: items.length - filtered.length };
}

function hideShorts(shelves, shortsEnabled, onRemoveShelf) {
  if (shortsEnabled || !Array.isArray(shelves)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) continue;

    if (isShortsShelfTitle(getShelfTitle(shelf)) || shelf.shelfRenderer?.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS') {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const items = shelf.shelfRenderer?.content?.horizontalListRenderer?.items;
    if (!Array.isArray(items)) continue;
    shelf.shelfRenderer.content.horizontalListRenderer.items = items.filter(
      (item) => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS'
    );
  }
}

function shouldHideWatchedForPage(configPages, page) {
  if (!Array.isArray(configPages) || configPages.length === 0) return true;
  if (configPages.includes(page)) return true;

  // Library playlist overview / watch-next should follow library watched-filter setting.
  if (configPages.includes('library') && (page === 'playlist' || page === 'watch')) {
    return true;
  }

  return false;
}

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  
  const playlistPage = isPlaylistPage(page);
  
  // ⭐ FILTER MODE: Only show videos from our collected list
  const filterIds = getFilteredVideoIds();
  
  if (playlistPage && filterIds) {
    console.log('[FILTER_MODE] 🔄 Active - filtering to', filterIds.size, 'unwatched videos');
    
    const filtered = arr.filter(item => {
      const videoId = item.tileRenderer?.contentId || 
                     item.videoRenderer?.videoId || 
                     item.playlistVideoRenderer?.videoId ||
                     item.gridVideoRenderer?.videoId ||
                     item.compactVideoRenderer?.videoId;
      
      const keep = filterIds.has(videoId);
      if (!keep && videoId) {
        console.log('[FILTER_MODE] 🔄 Hiding (not in unwatched list):', videoId);
      }
      return keep;
    });
    
  const shortsEnabled = configRead('enableShorts');
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if we should filter watched videos on this page (EXACT match)
  const shouldHideWatched = configRead('enableHideWatchedVideos');
  
  
  // ⭐ Initialize scroll helpers tracker
  if (!window._playlistScrollHelpers) {
    window._playlistScrollHelpers = new Set();
  }
  if (!window._lastHelperVideos) {
    window._lastHelperVideos = [];
  }

  // ⭐ NEW: Check if this is the LAST batch (using flag from response level)
  let isLastBatch = false;
  if (isPlaylistPage && window._isLastPlaylistBatch === true) {
    isLastBatch = true;
    // Clear the flag
    window._isLastPlaylistBatch = false;
  }
  
  const filtered = arr.filter(item => {
    if (!item) return true;

    // KrX needed to hide shorts on subscription
    if (!shortsEnabled && isShortItem(item, { currentPage: page || getCurrentPage() })) {
      return false;
    }

    // ⭐ Removed watched on channels, subscriptions and watch page
    if (shouldHideWatched) {
      const progressBar = findProgressBar(item);
      
      // Calculate progress percentage
      const percentWatched = progressBar ? Number(progressBar.percentDurationWatched || 0) : 0;
      
      // Hide if watched above threshold
      if (percentWatched >= threshold) {
        return false;
      }
    }
    return true;
  });
  
  // ⭐ KrX, needed or no videos at playlist if first batch is completly watched 
  // PLAYLIST SAFEGUARD: keep one helper tile so TV can request next batch.
  if (isPlaylistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    
    const lastVideo = [...arr].reverse().find((item) => !!getVideoId(item)) || arr[arr.length - 1];
    const lastVideoId = getVideoId(lastVideo) || 'unknown';
    window._lastHelperVideos = [lastVideo];
    window._playlistScrollHelpers.clear();
    window._playlistScrollHelpers.add(lastVideoId);
    return [lastVideo];
  }
  
  // ⭐ Clean up after filtering if last batch
  if (isLastBatch && isPlaylistPage) {
    window._lastHelperVideos = [];
    window._playlistScrollHelpers.clear();
  }
  
  return filtered;
}

// KrX needed for hiding shorts and watched videos in subscription, channels and playlist
function scanAndFilterAllArrays(obj, page, path = 'root') {
  if (!obj || typeof obj !== 'object') return;
  
  // If this is an array with video items, filter it
  if (Array.isArray(obj) && obj.length > 0) {
    // Check if it looks like a video items array
    const hasVideoItems = obj.some(item => 
      item?.tileRenderer || 
      item?.videoRenderer || 
      item?.gridVideoRenderer ||
      item?.compactVideoRenderer ||
      item?.richItemRenderer?.content?.videoRenderer
    );
    
    if (hasVideoItems) {
      return directFilterArray(obj, page, path);
    }
    
    // Check if this is a shelves array - remove empty shelves after filtering
    const hasShelves = obj.some(item =>
      item?.shelfRenderer ||
      item?.richShelfRenderer ||
      item?.gridRenderer
    );
    
    if (hasShelves) {
      // Filter shelves recursively
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const value = obj[key];
          if (value && typeof value === 'object') {
            scanAndFilterAllArrays(value, page, path + '[' + key + ']');
          }
        }
      }

      // Then remove empty shelves
      for (let i = obj.length - 1; i >= 0; i--) {
        const shelf = obj[i];
        if (!shelf) {
          obj.splice(i, 1);
          continue;
        }
        
      }
      return; // Don't return the array, we modified it in place
    }
  }

  // Recursively scan object properties
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      
      if (Array.isArray(value)) {
        // Filter this array
        const filtered = scanAndFilterAllArrays(value, page, path + '.' + key);
        if (filtered) {
          obj[key] = filtered;
        }
      } else if (value && typeof value === 'object') {
        // Recurse into objects
        scanAndFilterAllArrays(value, page, path + '.' + key);
      }
    }
  }
}

// ⭐ AUTO-LOAD STATE: Must be outside JSON.parse to persist across responses
let autoLoadInProgress = false;
let autoLoadAttempts = 0;
const MAX_AUTO_LOAD_ATTEMPTS = 100;
let skipUniversalFilter = false;  // ⭐ NEW: Global flag to skip filtering during auto-load

// ⭐ AUTO-LOADER FUNCTION: Must be in global scope so setTimeout can access it
function startPlaylistAutoLoad() {
  console.log('▶▶▶▶▶▶▶▶▶▶ AUTO-LOAD CALLED ◀◀◀◀◀◀◀◀◀◀');
  const currentPage = getCurrentPage();
  console.log('▶▶▶ Current page:', currentPage);
  console.log('▶▶▶ autoLoadInProgress:', autoLoadInProgress);

  // Playlist-only flow: if navigation changed while deferred callbacks are pending,
  // ensure we fully reset and skip auto-loader work.
  if (currentPage !== 'playlist' && currentPage !== 'playlists') {
    autoLoadInProgress = false;
    skipUniversalFilter = false;
    if (DEBUG_ENABLED) {
      console.log('[PLAYLIST_AUTOLOAD] Aborting: page is no longer a playlist');
    }
    return;
  }
  
  if (autoLoadInProgress) {
    if (DEBUG_ENABLED) {
      console.log('[PLAYLIST_AUTOLOAD] Already in progress, skipping');
    }
    return;
  }
  
  autoLoadInProgress = true;
  autoLoadAttempts = 0;
  skipUniversalFilter = true;  // ⭐ ADD THIS - prevents filtering during auto-load
  
  if (DEBUG_ENABLED) {
    console.log('[PLAYLIST_AUTOLOAD] ========================================');
    console.log('[PLAYLIST_AUTOLOAD] Starting auto-load process');
    console.log('[PLAYLIST_AUTOLOAD] ========================================');
  }
  
  let lastVideoCount = 0;
  let stableCount = 0;
  
  const autoLoadInterval = setInterval(() => {
    autoLoadAttempts++;
    
    // Safety: Stop after too many attempts
    if (autoLoadAttempts > MAX_AUTO_LOAD_ATTEMPTS) {
      if (DEBUG_ENABLED) {
        console.log('[PLAYLIST_AUTOLOAD] Max attempts reached, stopping');
      }
      clearInterval(autoLoadInterval);
      autoLoadInProgress = false;
      skipUniversalFilter = false;
      return;
    }
    
    // Count current videos
    const videoElements = document.querySelectorAll('ytlr-tile-renderer');
    const currentCount = videoElements.length;
    
    if (DEBUG_ENABLED && autoLoadAttempts % 5 === 0) {
      console.log(`[PLAYLIST_AUTOLOAD] Attempt ${autoLoadAttempts}: ${currentCount} videos loaded`);
    }
    
    // Scroll to bottom to trigger loading
    window.scrollTo(0, document.body.scrollHeight);
    
    // Check if video count has stabilized (no new videos loading)
    if (currentCount === lastVideoCount) {
      stableCount++;
      
      // If count stable for 3 checks, we're done
      if (stableCount >= 3) {
        if (DEBUG_ENABLED) {
          console.log('[PLAYLIST_AUTOLOAD] ========================================');
          console.log('[PLAYLIST_AUTOLOAD] All videos loaded!');
          console.log('[PLAYLIST_AUTOLOAD] Total videos:', currentCount);
          console.log('[PLAYLIST_AUTOLOAD] Now applying filters...');
          console.log('[PLAYLIST_AUTOLOAD] ========================================');
        }
        
        clearInterval(autoLoadInterval);
        autoLoadInProgress = false;
        skipUniversalFilter = false;  // ⭐ ADD THIS - re-enable filtering
        
        // Scroll back to top
        window.scrollTo(0, 0);
        
        // Force a page refresh to apply filters
        setTimeout(() => {
          const page = getCurrentPage();
          scanAndFilterAllArrays(document, page);
          
          if (DEBUG_ENABLED) {
            console.log('[PLAYLIST_AUTOLOAD] Filtering complete!');
          }
        }, 500);
      }
    } else {
      stableCount = 0;
      lastVideoCount = currentCount;
    }
  }, 500);
}

// ⭐ PLAYLIST COLLECTION MODE: Store unwatched videos, then reload filtered
const PLAYLIST_STORAGE_KEY = 'tizentube_playlist_unwatched';

function isInCollectionMode() {
  const stored = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!stored) return false;
  
  try {
    const data = JSON.parse(stored);
    // Collection mode expires after 5 minutes
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(PLAYLIST_STORAGE_KEY);
      return false;
    }
    return data.mode === 'collecting';
  } catch {
    return false;
  }
}

function getFilteredVideoIds() {
  const stored = localStorage.getItem(PLAYLIST_STORAGE_KEY);
  if (!stored) return null;
  
  try {
    const data = JSON.parse(stored);
    if (data.mode === 'filtering' && Array.isArray(data.videoIds)) {
      if (data.videoIds.length === 0) {
        localStorage.removeItem(PLAYLIST_STORAGE_KEY);
        return null;
      }
      return new Set(data.videoIds);
    }
  } catch {}
  return null;
}

function startCollectionMode() {
  console.log('🔄🔄🔄 STARTING COLLECTION MODE');
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({
    mode: 'collecting',
    timestamp: Date.now(),
    videoIds: []
  }));
  
  // Reload page to start fresh
  window.location.reload();
}

function finishCollectionAndFilter(unwatchedIds) {
  console.log('🔄🔄🔄 COLLECTION COMPLETE - Switching to filter mode');
  console.log('🔄 Total unwatched videos:', unwatchedIds.length);
  
  localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify({
    mode: 'filtering',
    timestamp: Date.now(),
    videoIds: unwatchedIds
  }));
  
  // Reload page in filter mode
  window.location.reload();
}

function exitFilterMode() {
  console.log('🔄🔄🔄 EXITING FILTER MODE');
  localStorage.removeItem(PLAYLIST_STORAGE_KEY);
  window.location.reload();
}

// ⭐ Track collected unwatched videos during collection mode
window._collectedUnwatched = window._collectedUnwatched || [];

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);

  if (r?.title?.runs) {
    PatchSettings(r);
  }
  
  // Handle singleColumnBrowseResultsRenderer (alternative playlist format)
  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    
    // Scan and filter ALL arrays
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
  }
  // UNIVERSAL FALLBACK - Filter EVERYTHING if we're on a critical page
  const currentPage = getCurrentPage();
  const criticalPages = ['subscriptions', 'library', 'history', 'playlist', 'channel', 'watch'];

  if (criticalPages.includes(currentPage) && !r.__universalFilterApplied) {
    r.__universalFilterApplied = true;
    
    // Scan the ENTIRE response object and filter ALL video arrays
    scanAndFilterAllArrays(r, currentPage);
  }
  return r;
};

window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}

function findProgressBar(item) {
  if (!item) return null;
  
  const checkRenderer = (renderer) => {
    if (!renderer) return null;
    
    // Comprehensive overlay paths
    const overlayPaths = [
      // Standard paths (Tizen 6.5)
      renderer.thumbnailOverlays,
      renderer.header?.tileHeaderRenderer?.thumbnailOverlays,
      renderer.thumbnail?.thumbnailOverlays,
      
      // Alternative paths (Tizen 5.0)
      renderer.thumbnailOverlayRenderer,
      renderer.overlay,
      renderer.overlays
    ];
    
    for (const overlays of overlayPaths) {
      if (!overlays) continue;
      
      // Handle array
      if (Array.isArray(overlays)) {
        const progressOverlay = overlays.find(o => 
          o?.thumbnailOverlayResumePlaybackRenderer
        );
        if (progressOverlay) {
          return progressOverlay.thumbnailOverlayResumePlaybackRenderer;
        }
      } 
      // Handle direct object
      else if (overlays.thumbnailOverlayResumePlaybackRenderer) {
        return overlays.thumbnailOverlayResumePlaybackRenderer;
      }
    }
    return null;
  };
  
  // Check all renderer types
  const rendererTypes = [
    item.tileRenderer,
    item.playlistVideoRenderer,
    item.compactVideoRenderer,
    item.gridVideoRenderer,
    item.videoRenderer,
    item.richItemRenderer?.content?.videoRenderer,
    item.richItemRenderer?.content?.reelItemRenderer
  ];
  
  for (const renderer of rendererTypes) {
    const result = checkRenderer(renderer);
    if (result) return result;
  }
  
  return null;
}

function getCurrentPage() {
  const hash = location.hash ? location.hash.substring(1) : '';
  const path = location.pathname || '';
  const search = location.search || '';
  const href = location.href || '';
  
  const cleanHash = hash.split('?additionalDataUrl')[0];
  
  // Extract browse parameters
  let browseParam = '';
  const cMatch = hash.match(/[?&]c=([^&]+)/i);
  if (cMatch) {
    browseParam = cMatch[1].toLowerCase();
  }
  
  const browseIdMatch = hash.match(/\/browse\/([^?&#]+)/i);
  if (browseIdMatch) {
    const browseId = browseIdMatch[1].toLowerCase();
    if (!browseParam) browseParam = browseId;
  }
  
  const combined = (cleanHash + ' ' + path + ' ' + search + ' ' + href + ' ' + browseParam).toLowerCase();
  
  let detectedPage = 'other';
  
  // PRIORITY 1: Check browse parameters (Tizen TV uses these!)
  
  // Subscriptions
  if (browseParam.includes('fesubscription')) {
    detectedPage = 'subscriptions';
  }
  
  // Library and its sub-pages
  else if (browseParam === 'felibrary') {
    detectedPage = 'library';
  }
  else if (browseParam === 'fehistory') {
    detectedPage = 'history';
  }
  else if (browseParam === 'femy_youtube') {
    detectedPage = 'playlist'; // Watch Later via library tab
  }
  else if (browseParam === 'feplaylist_aggregation') {
    detectedPage = 'playlists';
  }
  
  // Individual playlists (VL prefix = Video List)
  else if (browseParam.startsWith('vlpl')) {
    detectedPage = 'playlist'; // User playlist
  }
  else if (browseParam === 'vlwl') {
    detectedPage = 'playlist'; // Watch Later
  }
  else if (browseParam === 'vlll') {
    detectedPage = 'playlist'; // Liked Videos
  }
  
  // Topics (home variations)
  else if (browseParam.includes('fetopics_music') || browseParam.includes('music')) {
    detectedPage = 'music';
  }
  else if (browseParam.includes('fetopics_gaming') || browseParam.includes('gaming')) {
    detectedPage = 'gaming';
  }
  else if (browseParam.includes('fetopics')) {
    detectedPage = 'home';
  }
  
  // Channel pages
  else if (browseParam.startsWith('uc') && browseParam.length > 10) {
    detectedPage = 'channel';
  }
  
  // PRIORITY 2: Check traditional patterns
  else if (cleanHash.includes('/playlist') || combined.includes('list=')) {
    detectedPage = 'playlist';
  }
  else if (cleanHash.includes('/results') || cleanHash.includes('/search')) {
    detectedPage = 'search';
  }
  else if (cleanHash.includes('/watch')) {
    detectedPage = 'watch';
  }
  else if (cleanHash.includes('/@') || cleanHash.includes('/channel/')) {
    detectedPage = 'channel';
  }
  else if (cleanHash.includes('/browse') && !browseParam) {
    detectedPage = 'home';
  }
  else if (cleanHash === '' || cleanHash === '/') {
    detectedPage = 'home';
  }
  
  return detectedPage;
}


function logChunkedByLines(prefix, text, linesPerChunk = 60) {
  if (!text) return;
  const lines = String(text).split('\n');
  const total = Math.max(1, Math.ceil(lines.length / linesPerChunk));
  for (let partIndex = total; partIndex >= 1; partIndex--) {
    const startLine = (partIndex - 1) * linesPerChunk;
    const part = lines.slice(startLine, startLine + linesPerChunk).join('\n');
    console.log(`${prefix} [${partIndex}/${total}] lines=${Math.min(linesPerChunk, lines.length - startLine)} ${part}`);
  }
}

function triggerPlaylistContinuationLoad() {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  if (DEBUG_ENABLED) {
    console.log('[CONTINUATION_TRIGGER] Attempting to load more playlist videos...');
  }

  // ⭐ Strategy 1: Scroll the virtual list container
  const virtualList = document.querySelector('yt-virtual-list') || 
                      document.querySelector('[class*="virtual-list"]') ||
                      document.querySelector('ytlr-playlist-video-list-renderer');
  
  if (virtualList) {
    try {
      const maxScroll = virtualList.scrollHeight || 0;
      virtualList.scrollTop = maxScroll;
      virtualList.dispatchEvent(new Event('scroll', { bubbles: true }));
      console.log('[CONTINUATION_TRIGGER] Scrolled virtual list to:', maxScroll);
    } catch (e) {
      console.warn('[CONTINUATION_TRIGGER] Virtual list scroll failed:', e);
    }
  }

  // ⭐ Strategy 2: Scroll the window
  try {
    const maxY = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    window.scrollTo(0, maxY);
    console.log('[CONTINUATION_TRIGGER] Scrolled window to:', maxY);
  } catch (e) {
    console.warn('[CONTINUATION_TRIGGER] Window scroll failed:', e);
  }
  
  // ⭐ Strategy 3: Click any visible continuation buttons
  setTimeout(() => {
    const contButtons = document.querySelectorAll('[class*="continuation"]');
    contButtons.forEach(btn => {
      if (btn.offsetParent !== null) { // Check if visible
        try {
          btn.click();
          console.log('[CONTINUATION_TRIGGER] Clicked continuation button');
        } catch (e) {}
      }
    });
  }, 200);
}

function cleanupPlaylistHelperTiles() {
  const page = getCurrentPage();
  if (page !== 'playlist') return;

  const removedIds = window._playlistRemovedHelpers || new Set();
  const removedKeys = window._playlistRemovedHelperKeys || new Set();
  const currentHelperIds = new Set((window._lastHelperVideos || []).map((video) => getVideoId(video)).filter(Boolean));
  
  // ⭐ VERY AGGRESSIVE: Query ALL possible video elements
  const candidates = document.querySelectorAll(`
    ytlr-grid-video-renderer,
    ytlr-tile-renderer,
    ytlr-playlist-video-renderer,
    ytlr-video-renderer,
    ytlr-continuation-item-renderer,
    [class*="continuation"],
    [class*="helper"],
    [data-video-id]
  `);
  
  let removedCount = 0;
  let hiddenCount = 0;

  candidates.forEach((node) => {
    const videoId = node.getAttribute('data-video-id') || 
                    node.getAttribute('video-id') || 
                    node.dataset?.videoId || '';
    
    const text = (node.textContent || '').toLowerCase();
    const html = (node.innerHTML || '').toLowerCase();
    
    const looksLikeHelper = /scroll|weiter|more|continuation|fortsetzen|laden|mehr anzeigen|more videos|load more|helper/i.test(text) || 
                           /continuation|loadmore|mehr|helper/i.test(html);
    
    const isStoredHelper = videoId && (removedIds.has(videoId) || currentHelperIds.has(videoId));
    
    // ⭐ AGGRESSIVE: Remove or hide
    if (looksLikeHelper || isStoredHelper) {
      try {
        // Try to fully remove
        node.remove();
        removedCount++;
      } catch (e) {
        // If removal fails, hide it completely
        try {
          node.style.display = 'none';
          node.style.visibility = 'hidden';
          node.style.position = 'absolute';
          node.style.left = '-9999px';
          node.style.width = '0';
          node.style.height = '0';
          node.style.opacity = '0';
          node.setAttribute('aria-hidden', 'true');
          hiddenCount++;
        } catch (e2) {
          console.warn('[HELPER_CLEANUP_DOM] Failed to hide:', e2);
        }
      }
    }
  });

  if (removedCount > 0 || hiddenCount > 0) {
    if (DEBUG_ENABLED) {
      console.log('[HELPER_CLEANUP_DOM] Removed:', removedCount, '| Hidden:', hiddenCount);
    }
  }
}
