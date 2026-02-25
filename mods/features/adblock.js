import { configRead } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import { PatchSettings } from '../ui/customYTSettings.js';


const PLAYLIST_PAGES = new Set(['playlist', 'playlists']);
const BROWSE_PAGE_MAP = {
  felibrary: 'library',
  fehistory: 'history',
  femy_youtube: 'playlist',
  feplaylist_aggregation: 'playlists',
  vlwl: 'playlist',
  vlll: 'playlist'
};

function isPlaylistPage(page) {
  return PLAYLIST_PAGES.has(page);
}

function getShelfTitle(shelf) {
  return (
    shelf?.shelfRenderer?.title?.runs?.[0]?.text ||
    shelf?.shelfRenderer?.title?.simpleText ||
    shelf?.richShelfRenderer?.title?.runs?.[0]?.text ||
    shelf?.richShelfRenderer?.title?.simpleText ||
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title?.runs?.[0]?.text ||
    shelf?.richSectionRenderer?.content?.richShelfRenderer?.title?.simpleText ||
    ''
  );
}

function hideShorts(shelves, shortsEnabled, onRemoveShelf) {
  if (shortsEnabled || !Array.isArray(shelves)) return;

  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelf = shelves[i];
    if (!shelf) continue;

    const isShortShelf = getShelfTitle(shelf).toLowerCase().includes('short') ||
      shelf?.shelfRenderer?.tvhtml5ShelfRendererType === 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';

    if (isShortShelf) {
      onRemoveShelf?.(shelf);
      shelves.splice(i, 1);
      continue;
    }

    const items = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items;
    if (!Array.isArray(items)) continue;

    shelf.shelfRenderer.content.horizontalListRenderer.items = items.filter(
      (item) => item.tileRenderer?.tvhtml5ShelfRendererType !== 'TVHTML5_TILE_RENDERER_TYPE_SHORTS'
    );
  }
}

//KrX if removed breaks suscription, library all videos ar removed and hsorts on home page only 3 shelfs remain, so filters everything
function isShortItem(item, { currentPage = '' } = {}) {
  if (!item) return false;

  if (item.tileRenderer) {
    let lengthText = null;
    const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
      const timeOverlay = thumbnailOverlays.find((overlay) => overlay.thumbnailOverlayTimeStatusRenderer);
      if (timeOverlay) {
        lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
      }
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
        // Shorts can be nowt till 3min
        if (totalSeconds <= 180) {
          return true;
        }
      }
    }
  }

  return false;
}

function getVideoId(item) {
  return item?.tileRenderer?.contentId ||
    item?.videoRenderer?.videoId ||
    item?.playlistVideoRenderer?.videoId ||
    item?.gridVideoRenderer?.videoId ||
    item?.compactVideoRenderer?.videoId ||
    item?.richItemRenderer?.content?.videoRenderer?.videoId ||
    null;
}

function directFilterArray(arr, page, context = '') {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  
    
  const shortsEnabled = configRead('enableShorts');
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if we should filter watched videos on this page (EXACT match)
  const shouldHideWatched = configRead('enableHideWatchedVideos');
  
  const playlistPage = isPlaylistPage(page);
  
  // ⭐ Initialize scroll helpers tracker
  if (!window._playlistScrollHelpers) {
    window._playlistScrollHelpers = new Set();
  }
  if (!window._lastHelperVideos) {
    window._lastHelperVideos = [];
  }

  // ⭐ NEW: Check if this is the LAST batch (using flag from response level)
  let isLastBatch = false;
  if (playlistPage && window._isLastPlaylistBatch === true) {
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
  if (playlistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    
    const lastVideo = [...arr].reverse().find((item) => !!getVideoId(item)) || arr[arr.length - 1];
    const lastVideoId = getVideoId(lastVideo) || 'unknown';
    window._lastHelperVideos = [lastVideo];
    window._playlistScrollHelpers.clear();
    window._playlistScrollHelpers.add(lastVideoId);
    return [lastVideo];
  }
  
  // ⭐ Clean up after filtering if last batch
  if (isLastBatch && playlistPage) {
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
      hideShorts(obj, configRead('enableShorts'));

      // Filter shelves recursively
      for (let i = obj.length - 1; i >= 0; i--) {
        const shelf = obj[i];
        if (!shelf) {
          obj.splice(i, 1);
          continue;
        }
        scanAndFilterAllArrays(shelf, page, path + '[' + i + ']');

        const horizontalItems = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items;
        const gridItems = shelf?.shelfRenderer?.content?.gridRenderer?.items;
        const richItems = shelf?.richShelfRenderer?.content?.richGridRenderer?.contents;
        const hasItems =
          (Array.isArray(horizontalItems) && horizontalItems.length > 0) ||
          (Array.isArray(gridItems) && gridItems.length > 0) ||
          (Array.isArray(richItems) && richItems.length > 0);

        if (!hasItems && (shelf?.shelfRenderer || shelf?.richShelfRenderer || shelf?.gridRenderer)) {
          obj.splice(i, 1);
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
  
  else if (BROWSE_PAGE_MAP[browseParam]) {
    detectedPage = BROWSE_PAGE_MAP[browseParam];
  }
  else if (browseParam.startsWith('vlpl')) {
    detectedPage = 'playlist'; // User playlist
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