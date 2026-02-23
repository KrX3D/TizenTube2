import { configRead } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import { hideShorts } from './hideShorts.js';
import { isShortItem, shouldFilterShorts } from './shortsCore.js';
import { PatchSettings } from '../ui/customYTSettings.js';

// ⭐ CONFIGURATION: Set these to control logging output
const LOG_SHORTS = false;   // Set false to disable shorts logging  
const LOG_WATCHED = true;  // Set true to enable verbose watched-video logging

// ⭐ PERFORMANCE: Read debug setting ONCE and cache it globally
// Updated automatically via config change events
let DEBUG_ENABLED = configRead('enableDebugConsole');

// ⭐ EXPOSE: Allow external code to update the cache
window.adblock = window.adblock || {};
window.adblock.setDebugEnabled = function(value) {
    DEBUG_ENABLED = value;
    console.log('[CONFIG] Debug console ' + (DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'));
};
// Listen for config changes to update DEBUG_ENABLED cache
if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (window.configChangeEmitter) {
      window.configChangeEmitter.addEventListener('configChange', (e) => {
        if (e.detail?.key === 'enableDebugConsole') {
          DEBUG_ENABLED = e.detail.value;
          console.log('[CONFIG] Debug console ' + (DEBUG_ENABLED ? 'ENABLED' : 'DISABLED'));
        }
      });
    }
  }, 100);
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
  
  // ⭐ Check if this is a playlist page
  let isPlaylistPage;
    
  const shortsEnabled = configRead('enableShorts');
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if we should filter watched videos on this page (EXACT match)
  const shouldHideWatched = configRead('enableHideWatchedVideos');
  
  // Shorts filtering is INDEPENDENT - always check if shorts are disabled
  const shouldApplyShortsFilter = shouldFilterShorts(shortsEnabled, page);
  
  // ⭐ Check if this is a playlist page
  isPlaylistPage = (page === 'playlist' || page === 'playlists');
  
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
    if (shouldApplyShortsFilter && isShortItem(item, { debugEnabled: DEBUG_ENABLED, logShorts: LOG_SHORTS, currentPage: page || getCurrentPage() })) {
      return false;
    }
    
    return true;
  });
  
  // ⭐ PLAYLIST SAFEGUARD: keep one helper tile so TV can request next batch.
  if (isPlaylistPage && filtered.length === 0 && arr.length > 0 && !isLastBatch) {
    
    const lastVideo = [...arr].reverse().find((item) => !!getVideoId(item)) || arr[arr.length - 1];
    const lastVideoId = getVideoId(lastVideo) || 'unknown';
    if (DEBUG_ENABLED) {
      console.log('[HELPER] ALL FILTERED - keeping 1 helper for continuation trigger:', lastVideoId);
    }
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
        
        let isEmpty = false;
        
        if (shelf.shelfRenderer?.content?.horizontalListRenderer?.items) {
          isEmpty = shelf.shelfRenderer.content.horizontalListRenderer.items.length === 0;
        } else if (shelf.shelfRenderer?.content?.gridRenderer?.items) {
          isEmpty = shelf.shelfRenderer.content.gridRenderer.items.length === 0;
        } else if (shelf.shelfRenderer?.content?.verticalListRenderer?.items) {
          isEmpty = shelf.shelfRenderer.content.verticalListRenderer.items.length === 0;
        } else if (shelf.richShelfRenderer?.content?.richGridRenderer?.contents) {
          isEmpty = shelf.richShelfRenderer.content.richGridRenderer.contents.length === 0;
        } else if (shelf.gridRenderer?.items) {
          isEmpty = shelf.gridRenderer.items.length === 0;
        }
        
        if (isEmpty) {
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

  // Drop "masthead" ad from home screen
  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const currentPage = getCurrentPage();
    
    // ONLY process once per unique response object
    if (!r.__tizentubeProcessedBrowse) {
      r.__tizentubeProcessedBrowse = true;
      processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
    } else {
      if (DEBUG_ENABLED) {
        console.log('[JSON.parse] tvBrowseRenderer already processed, SKIPPING');
      }
    }
  }

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  if (r?.contents?.sectionListRenderer?.contents) {
    if (!r.__tizentubeProcessedSection) {
      r.__tizentubeProcessedSection = true;
      processShelves(r.contents.sectionListRenderer.contents);
    }
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    const page = getCurrentPage();
    const effectivePage = page === 'other' ? (window._lastDetectedPage || page) : page;

    scanAndFilterAllArrays(r.continuationContents.sectionListContinuation.contents, effectivePage, 'sectionListContinuation');
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  // Handle PLAYLIST continuations (different from section continuations!)
  if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
    const page = getCurrentPage();
    
    // ⭐ CHECK FOR LAST PAGE HERE (where we have full response)
    const hasContinuation = !!r.continuationContents.playlistVideoListContinuation.continuations;
    
    if (!hasContinuation) {
      // Set flag for directFilterArray to read
      window._isLastPlaylistBatch = true;
    } else {
      window._isLastPlaylistBatch = false;
    }
  }
  
  // Handle onResponseReceivedActions (lazy-loaded channel tabs AND PLAYLIST SCROLLING)
  if (r?.onResponseReceivedActions) {
    const page = getCurrentPage();
    
    r.onResponseReceivedActions.forEach((action, idx) => {
      // Handle appendContinuationItemsAction (playlist/channel/subscription continuations)
      if (action.appendContinuationItemsAction?.continuationItems) {
        let items = action.appendContinuationItemsAction.continuationItems;
        
        // First scan recursively so shelf-like continuation payloads on Tizen 5.5/6.5 also get filtered.
        scanAndFilterAllArrays(items, page, `onResponse-${idx}`);

        // Then direct-filter top-level arrays with videos.
        const filtered = directFilterArray(items, page, `continuation-${idx}`);
        action.appendContinuationItemsAction.continuationItems = filtered;
      }
    });
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer) {
    const page = getCurrentPage();
    
    if (page === 'subscriptions' && !r.__tizentubeProcessedSubs) {
      r.__tizentubeProcessedSubs = true;
      
      const sections = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections || [];
            
      sections.forEach((section, idx) => {
        if (!section.tvSecondaryNavSectionRenderer?.items) return;
        
        const items = section.tvSecondaryNavSectionRenderer.items;
        
        items.forEach((item, itemIdx) => {
          // Skip navigation links (compactLinkRenderer)
          if (item.compactLinkRenderer) {
            return;
          }
          
          const content = item.tvSecondaryNavItemRenderer?.content;
          
          // Process shelf content
          if (content?.shelfRenderer) {
            processShelves([content]);
          }
          // Process rich grid content
          else if (content?.richGridRenderer?.contents) {
            const filtered = directFilterArray(
              content.richGridRenderer.contents,
              page,
              `subscriptions-section-${idx}-item-${itemIdx}`
            );
            content.richGridRenderer.contents = filtered;
          }
        });
      });
    }
  }

  // ⭐ FIXED: Removed redundant window.location.hash.includes('list=') check
  // We already know the page type from getCurrentPage()
  //if (r?.contents?.singleColumnBrowseResultsRenderer && window.location.hash.includes('list=')) {
  if (r?.contents?.singleColumnBrowseResultsRenderer) {
    const page = getCurrentPage();
    
    // Only process if it's actually a playlist page
    if (page === 'playlist') {
      
      const tabs = r.contents.singleColumnBrowseResultsRenderer.tabs;
      if (tabs) {
        tabs.forEach((tab, idx) => {
          if (tab.tabRenderer?.content?.sectionListRenderer?.contents) {
            processShelves(tab.tabRenderer.content.sectionListRenderer.contents);
          }
        });
      }
    }
  }
  
  // Handle singleColumnBrowseResultsRenderer (alternative playlist format)
  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    
    // Scan and filter ALL arrays
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
  }

  if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
    processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents);
  }
  
  // UNIVERSAL FALLBACK - Filter EVERYTHING if we're on a critical page
  const currentPage = getCurrentPage();
  const criticalPages = ['subscriptions', 'library', 'history', 'playlist', 'channel', 'watch'];
  //const criticalPages = ['subscriptions', 'library', 'history', 'channel'];

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

function processShelves(shelves) {  
  if (!Array.isArray(shelves)) {
    return;
  }
  
  const page = getCurrentPage();
  const shortsEnabled = configRead('enableShorts');
  const shouldHideWatched = configRead('enableHideWatchedVideos');
  
  
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      const shelve = shelves[i];
      if (!shelve) continue;
      
      // Handle shelfRenderer
      if (shelve.shelfRenderer) {
        // horizontalListRenderer
        if (shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
          let items = shelve.shelfRenderer.content.horizontalListRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          
          if (shouldHideWatched) {
            items = hideVideo(items);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            items = originalItems;
          }
          
          shelve.shelfRenderer.content.horizontalListRenderer.items = items;
          
          if (items.length === 0) {
            shelves.splice(i, 1);
            continue;
          }
        }
        
        // gridRenderer
        else if (shelve.shelfRenderer.content?.gridRenderer?.items) {
          let items = shelve.shelfRenderer.content.gridRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          
          if (shouldHideWatched) {
            items = hideVideo(items);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            items = originalItems;
          }
          
          shelve.shelfRenderer.content.gridRenderer.items = items;
          
          if (items.length === 0) {
            shelves.splice(i, 1);
            continue;
          }
        }

        // verticalListRenderer
        else if (shelve.shelfRenderer.content?.verticalListRenderer?.items) {
          let items = shelve.shelfRenderer.content.verticalListRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          
          if (shouldHideWatched) {
            items = hideVideo(items);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            items = originalItems;
          }
          
          shelve.shelfRenderer.content.verticalListRenderer.items = items;
          
          if (items.length === 0) {
            shelves.splice(i, 1);
            continue;
          }
        }
      }
      
      // Handle richShelfRenderer (subscriptions)
      else if (shelve.richShelfRenderer?.content?.richGridRenderer?.contents) {
        let contents = shelve.richShelfRenderer.content.richGridRenderer.contents;
        const originalContents = Array.isArray(contents) ? contents.slice() : [];
        
        if (shouldHideWatched) {
          contents = hideVideo(contents);
        }
        if (shouldHideWatched && contents.length === 0 && originalContents.length > 0) {
          contents = originalContents;
        }
        
        shelve.richShelfRenderer.content.richGridRenderer.contents = contents;
        
        if (contents.length === 0) {
          shelves.splice(i, 1);
          continue;
        }
      }

      // Handle richSectionRenderer
      else if (shelve.richSectionRenderer?.content?.richShelfRenderer) {        
        if (!shortsEnabled) {
          const innerShelf = shelve.richSectionRenderer.content.richShelfRenderer;
          const contents = innerShelf?.content?.richGridRenderer?.contents;
          if (contents.length === 0) {
            shelves.splice(i, 1);
            continue;
          }
        }
      }

      // Handle gridRenderer at shelf level
      else if (shelve.gridRenderer?.items) {
        let items = shelve.gridRenderer.items;
        const originalItems = Array.isArray(items) ? items.slice() : [];
        
        if (shouldHideWatched) {
          items = hideVideo(items);
        }
        if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
          items = originalItems;
        }
        
        shelve.gridRenderer.items = items;
        
        if (items.length === 0) {
          shelves.splice(i, 1);
          continue;
        }
      }
      
    } catch (error) {
      if (DEBUG_ENABLED) {
        console.log('[SHELF] ERROR shelf', (shelves.length - i), ':', error.message);
      }
    }
  }
  
  // FINAL CLEANUP: Remove any remaining empty shelves
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    if (!shelve) {
      shelves.splice(i, 1);
      continue;
    }
    
    let isEmpty = false;
    
    if (shelve.shelfRenderer?.content?.horizontalListRenderer?.items) {
      isEmpty = shelve.shelfRenderer.content.horizontalListRenderer.items.length === 0;
    } else if (shelve.shelfRenderer?.content?.gridRenderer?.items) {
      isEmpty = shelve.shelfRenderer.content.gridRenderer.items.length === 0;
    } else if (shelve.shelfRenderer?.content?.verticalListRenderer?.items) {
      isEmpty = shelve.shelfRenderer.content.verticalListRenderer.items.length === 0;
    } else if (shelve.richShelfRenderer?.content?.richGridRenderer?.contents) {
      isEmpty = shelve.richShelfRenderer.content.richGridRenderer.contents.length === 0;
    } else if (shelve.gridRenderer?.items) {
      isEmpty = shelve.gridRenderer.items.length === 0;
    }
    
    if (isEmpty) {
      shelves.splice(i, 1);
    }
  }
}

function hideVideo(items) {
  // Simply delegate to directFilterArray - no code duplication!
  const page = getCurrentPage();
  return directFilterArray(items, page, 'hideVideo');
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

// Track last page to detect changes
let lastDetectedPage = null;

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
  
  // Logging
  const lastDetectedPage = window._lastDetectedPage;
  
  if (detectedPage !== lastDetectedPage) {
    window._lastDetectedPage = detectedPage;
  }
  
  return detectedPage;
}