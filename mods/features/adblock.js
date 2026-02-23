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

  // ⭐ Check if this is a playlist page
  isPlaylistPage = (page === 'playlist' || page === 'playlists');
    
  const shortsEnabled = configRead('enableShorts');
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const threshold = Number(configRead('hideWatchedVideosThreshold') || 0);
  
  // Check if we should filter watched videos on this page (EXACT match)
  const shouldHideWatched = hideWatchedEnabled;
  
  // Shorts filtering is INDEPENDENT - always check if shorts are disabled
  const shouldApplyShortsFilter = shouldFilterShorts(shortsEnabled, page);
  
  // Skip if nothing to do
  if (!shouldApplyShortsFilter && !shouldHideWatched) {
    return arr;
  }
  
  // Generate unique call ID for debugging
  const callId = Math.random().toString(36).substr(2, 6);
  
  // ⭐ Check if this is a playlist page
  isPlaylistPage = (page === 'playlist' || page === 'playlists');
  
  // ⭐ Initialize scroll helpers tracker
  if (!window._playlistScrollHelpers) {
    window._playlistScrollHelpers = new Set();
  }
  if (!window._lastHelperVideos) {
    window._lastHelperVideos = [];
  }
  if (!window._playlistRemovedHelpers) {
    window._playlistRemovedHelpers = new Set();
  }
  if (!window._playlistRemovedHelperKeys) {
    window._playlistRemovedHelperKeys = new Set();
  }
  
  // ⭐ DIAGNOSTIC: Log what we're checking
  if (isPlaylistPage && DEBUG_ENABLED) {
    console.log('>>>>>> PRE-CLEANUP CHECK <<<<<<');
    console.log('>>>>>> Has helpers:', window._lastHelperVideos?.length || 0);
    console.log('>>>>>> Array length:', arr.length);
    console.log('>>>>>> Context:', context);
    console.log('>>>>>> Last batch flag:', window._isLastPlaylistBatch);
  }

  // ⭐ NEW: Check if this is the LAST batch (using flag from response level)
  let isLastBatch = false;
  if (isPlaylistPage && window._isLastPlaylistBatch === true) {
    console.log('--------------------------------->> Using last batch flag from response');
    console.log('--------------------------------->> This IS the last batch!');
    isLastBatch = true;
    // Clear the flag
    window._isLastPlaylistBatch = false;
  }
  
  // ⭐ DEBUG: Log configuration
  if (DEBUG_ENABLED && (shouldApplyShortsFilter || shouldHideWatched)) {
    console.log('[FILTER_START #' + callId + '] ========================================');
    console.log('[FILTER_START #' + callId + '] Context:', context);
    console.log('[FILTER_START #' + callId + '] Page:', page);
    console.log('[FILTER_START #' + callId + '] Is Playlist:', isPlaylistPage);
    console.log('[FILTER_START #' + callId + '] Total items:', arr.length);
    console.log('[FILTER_CONFIG #' + callId + '] Threshold:', threshold + '%');
    console.log('[FILTER_CONFIG #' + callId + '] Hide watched:', shouldHideWatched);
    console.log('[FILTER_CONFIG #' + callId + '] Filter shorts:', shouldApplyShortsFilter);
  }
  
  let hiddenCount = 0;
  let shortsCount = 0;
  let noProgressBarCount = 0;
  const originalLength = arr.length;
  
  const filtered = arr.filter(item => {
    if (!item) return true;

    const videoId = item.tileRenderer?.contentId || 
                   item.videoRenderer?.videoId || 
                   item.playlistVideoRenderer?.videoId ||
                   item.gridVideoRenderer?.videoId ||
                   item.compactVideoRenderer?.videoId ||
                   'unknown';

    
    // ⭐ STEP 1: Filter shorts FIRST (before checking progress bars)
    if (shouldApplyShortsFilter && isShortItem(item, { debugEnabled: DEBUG_ENABLED, logShorts: LOG_SHORTS, currentPage: page || getCurrentPage() })) {
      shortsCount++;
      
      // ⭐ ADD VISUAL MARKER
      console.log('✂️✂️✂️ SHORT REMOVED:', videoId, '| Page:', page);

      if (LOG_SHORTS && DEBUG_ENABLED) {
        console.log('[FILTER #' + callId + '] REMOVED SHORT:', videoId);
      }
      return false;
    }
    
    // ⭐ STEP 2: Filter watched videos (only if enabled for this page)
    if (shouldHideWatched) {
      const progressBar = findProgressBar(item);
      
      // ⭐ PLAYLIST SPECIAL HANDLING: Only filter if progress bar EXISTS
      if (isPlaylistPage) {
        if (!progressBar) {
          // No progress bar = unwatched = KEEP IT
          noProgressBarCount++;
          
          if (LOG_WATCHED && DEBUG_ENABLED) {
            console.log('[FILTER #' + callId + '] ✓ KEEPING (playlist, no progress):', videoId);
          }
          return true;
        }
      }
      
      // Calculate progress percentage
      const percentWatched = progressBar ? Number(progressBar.percentDurationWatched || 0) : 0;
      
      // ⭐ DEBUG: Log each decision
      if (LOG_WATCHED && DEBUG_ENABLED) {
        const hasProgressBar = !!progressBar;
        const decision = percentWatched >= threshold ? '❌ HIDING' : '✓ KEEPING';
        console.log('[FILTER #' + callId + '] ' + decision + ':', videoId, '| Progress:', percentWatched + '%', '| Threshold:', threshold + '%');
      }
      
      // Hide if watched above threshold
      if (percentWatched >= threshold) {
        hiddenCount++;
        return false;
      }
    }
    
    return true;
  });
  
  // ⭐ Enhanced summary logging
  if (DEBUG_ENABLED) {
    console.log('[FILTER_END #' + callId + '] ========================================');
    console.log('[FILTER_END #' + callId + '] Original count:', originalLength);
    console.log('[FILTER_END #' + callId + '] Final count:', filtered.length);
    console.log('[FILTER_END #' + callId + '] Removed total:', (originalLength - filtered.length));
    console.log('[FILTER_END #' + callId + '] ├─ Watched removed:', hiddenCount);
    console.log('[FILTER_END #' + callId + '] ├─ Shorts removed:', shortsCount);
    if (shortsCount > 0) {
      console.log('✂️✂️✂️ TOTAL SHORTS FILTERED THIS BATCH:', shortsCount);
    }
    if (isPlaylistPage) {
      console.log('[FILTER_END #' + callId + '] └─ Unwatched kept (no progress):', noProgressBarCount);
    }
    console.log('[FILTER_END #' + callId + '] ========================================');
  }
  
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
    console.log('--------------------------------->> FINAL CLEANUP (last batch detected)');
    console.log('--------------------------------->> Clearing all helpers and trackers');
    window._lastHelperVideos = [];
    window._playlistScrollHelpers.clear();
    console.log('--------------------------------->> All helpers cleared!');
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
      if (DEBUG_ENABLED) {
        console.log('[SCAN] Found video array at:', path, '| Length:', obj.length);
      }
      return directFilterArray(obj, page, path);
    }
    
    // Check if this is a shelves array - remove empty shelves after filtering
    const hasShelves = obj.some(item =>
      item?.shelfRenderer ||
      item?.richShelfRenderer ||
      item?.gridRenderer
    );
    
    if (hasShelves) {
      const shortsEnabled = configRead('enableShorts');

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
          if (DEBUG_ENABLED) {
            console.log('[SCAN_CLEANUP] Removing empty shelf at:', path + '[' + i + ']');
          }
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

// ⭐ PLAYLIST COLLECTION MODE: Store unwatched videos, then reload filtered
const PLAYLIST_STORAGE_KEY = 'tizentube_playlist_unwatched';

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

// ⭐ Track collected unwatched videos during collection mode
window._collectedUnwatched = window._collectedUnwatched || [];

const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);

  // Drop "masthead" ad from home screen
  if (r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
    const currentPage = getCurrentPage();
    
    // ONLY process once per unique response object
    if (!r.__tizentubeProcessedBrowse) {
      r.__tizentubeProcessedBrowse = true;
      
      // ⭐ NON-PLAYLIST PAGES: Normal processing
      if (DEBUG_ENABLED) {
          console.log('[BROWSE] ==============tvBrowseRenderer============');
          console.log('[BROWSE] Page:', currentPage);
          console.log('[BROWSE] URL:', window.location.href);
          console.log('[BROWSE] Hash:', window.location.hash);
          console.log('[BROWSE] ========================================');
      }
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
      if (DEBUG_ENABLED) {
        console.log('SHELF_ENTRY', 'Processing sectionListRenderer.contents', {
          count: r.contents.sectionListRenderer.contents.length,
          page: getCurrentPage()
        });
      }
      processShelves(r.contents.sectionListRenderer.contents);
    } else {
      if (DEBUG_ENABLED) {
        console.log('[JSON.parse] sectionListRenderer already processed, SKIPPING');
      }
    }
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    const page = getCurrentPage();
    const effectivePage = page === 'other' ? (window._lastDetectedPage || page) : page;
    if (DEBUG_ENABLED) {
      console.log('[CONTINUATION]', page, '(effective:', effectivePage + ') - Processing', r.continuationContents.sectionListContinuation.contents.length, 'shelves');
    }

    if (window._lastLoggedPage !== effectivePage) {
      if (DEBUG_ENABLED) {
        console.log('[PAGE_DEBUG] ========================================');
        console.log('[PAGE_DEBUG] Page changed to:', effectivePage);
        console.log('[PAGE_DEBUG] URL:', window.location.href);
        console.log('[PAGE_DEBUG] Hash:', window.location.hash);
        console.log('[PAGE_DEBUG] ========================================');
      }
      window._lastLoggedPage = effectivePage;
    }

    scanAndFilterAllArrays(r.continuationContents.sectionListContinuation.contents, effectivePage, 'sectionListContinuation');
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  // Handle PLAYLIST continuations (different from section continuations!)
  if (r?.continuationContents?.playlistVideoListContinuation?.contents) {
    const page = getCurrentPage();
    
    // ⭐ CHECK FOR LAST PAGE HERE (where we have full response)
    const hasContinuation = !!r.continuationContents.playlistVideoListContinuation.continuations;
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('═══ PLAYLIST CONTINUATION DETECTED');
    console.log('═══ Page:', page);
    console.log('═══ Has continuation token:', hasContinuation);
    console.log('═══ Continuations object:', r.continuationContents.playlistVideoListContinuation.continuations);
    console.log('═══ Videos in batch:', r.continuationContents.playlistVideoListContinuation.contents.length);
    
    if (!hasContinuation) {
      console.log('═══ ⭐⭐⭐ THIS IS THE LAST BATCH! ⭐⭐⭐');
      // Set flag for directFilterArray to read
      window._isLastPlaylistBatch = true;
    } else {
      console.log('═══ More batches to come...');
      window._isLastPlaylistBatch = false;
    }
    console.log('═══════════════════════════════════════════════════════');
  
    
    // Continue with normal processing via universal filter
  }
  
  // Handle onResponseReceivedActions (lazy-loaded channel tabs AND PLAYLIST SCROLLING)
  if (r?.onResponseReceivedActions) {
    const page = getCurrentPage();
    const effectivePage = page === 'other' ? (window._lastDetectedPage || page) : page;
    
    if (DEBUG_ENABLED) {
      console.log('[ON_RESPONSE] ========================================');
      console.log('[ON_RESPONSE] Page:', page, '| effective:', effectivePage);
      console.log('[ON_RESPONSE] Actions:', r.onResponseReceivedActions.length);
    }
  
    // ⭐ NEW: Log playlist structure with MARKER
    if (page === 'playlist' || page === 'playlists') {
      console.log('#####################>>> PLAYLIST STRUCTURE DETECTED <<<#####################');
      console.log('#####################>>> Response keys:', Object.keys(r));
      console.log('#####################>>> Has contents:', !!r.contents);
      console.log('#####################>>> Has continuationContents:', !!r.continuationContents);
      console.log('#####################>>> Has onResponseReceivedActions:', !!r.onResponseReceivedActions);
      if (r.contents) {
        console.log('#####################>>> contents keys:', Object.keys(r.contents));
      }
      console.log('#####################>>> END PLAYLIST STRUCTURE <<<#####################');
    }
    
    r.onResponseReceivedActions.forEach((action, idx) => {
      // Handle appendContinuationItemsAction (playlist/channel/subscription continuations)
      if (action.appendContinuationItemsAction?.continuationItems) {
        let items = action.appendContinuationItemsAction.continuationItems;
        
        if (DEBUG_ENABLED) {
          console.log(`[ON_RESPONSE] Action ${idx}: appendContinuationItemsAction`);
          console.log(`[ON_RESPONSE] Items:`, items.length);
          if (items[0]) {
            console.log(`[ON_RESPONSE] First item keys:`, Object.keys(items[0]));
          }
        }

        // First scan recursively so shelf-like continuation payloads on Tizen 5.5/6.5 also get filtered.
        scanAndFilterAllArrays(items, page, `onResponse-${idx}`);

        // Then direct-filter top-level arrays with videos.
        const filtered = directFilterArray(items, page, `continuation-${idx}`);
        action.appendContinuationItemsAction.continuationItems = filtered;
      }
    });
    
    if (DEBUG_ENABLED) {
      console.log('[ON_RESPONSE] ========================================');
    }
  }


  if (r?.continuationContents?.horizontalListContinuation?.items) {
    if (DEBUG_ENABLED) {
      console.log('SHELF_ENTRY', 'Processing horizontal list continuation', {
        count: r.continuationContents.horizontalListContinuation.items.length
      });
    }
    r.continuationContents.horizontalListContinuation.items = hideVideo(r.continuationContents.horizontalListContinuation.items);
  }

  if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer) {
    const page = getCurrentPage();
    
    if (page === 'subscriptions' && !r.__tizentubeProcessedSubs) {
      r.__tizentubeProcessedSubs = true;
      
      if (LOG_WATCHED && DEBUG_ENABLED) {
        console.log('[SUBSCRIPTIONS] ========================================');
        console.log('[SUBSCRIPTIONS] Processing subscriptions page');
      }
      
      const sections = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections || [];
      
      if (LOG_WATCHED && DEBUG_ENABLED) {
        console.log('[SUBSCRIPTIONS] Sections found:', sections.length);
      }
      
      sections.forEach((section, idx) => {
        if (!section.tvSecondaryNavSectionRenderer?.items) return;
        
        const items = section.tvSecondaryNavSectionRenderer.items;
        
        items.forEach((item, itemIdx) => {
          // Skip navigation links (compactLinkRenderer)
          if (item.compactLinkRenderer) {
            if (LOG_WATCHED && DEBUG_ENABLED) {
              console.log(`[SUBSCRIPTIONS] Section ${idx}, Item ${itemIdx}: NAV LINK (skipping)`);
            }
            return;
          }
          
          const content = item.tvSecondaryNavItemRenderer?.content;
          
          // Process shelf content
          if (content?.shelfRenderer) {
            if (LOG_WATCHED && DEBUG_ENABLED) {
              console.log(`[SUBSCRIPTIONS] Section ${idx}, Item ${itemIdx}: SHELF`);
            }
            processShelves([content]);
          }
          // Process rich grid content
          else if (content?.richGridRenderer?.contents) {
            if (LOG_WATCHED && DEBUG_ENABLED) {
              console.log(`[SUBSCRIPTIONS] Section ${idx}, Item ${itemIdx}: RICH GRID (${content.richGridRenderer.contents.length} items)`);
            }
            const filtered = directFilterArray(
              content.richGridRenderer.contents,
              page,
              `subscriptions-section-${idx}-item-${itemIdx}`
            );
            content.richGridRenderer.contents = filtered;
          }
        });
      });
      
      if (LOG_WATCHED && DEBUG_ENABLED) {
        console.log('[SUBSCRIPTIONS] Processing complete');
        console.log('[SUBSCRIPTIONS] ========================================');
      }
    }
  }

  // Log library page structure
  if (r?.contents?.tvBrowseRenderer && getCurrentPage() === 'library') {
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[LIBRARY] ========================================');
        console.log('[LIBRARY] Structure detected');
        console.log('[LIBRARY] URL:', window.location.href);
      }
      
      if (r.contents.tvBrowseRenderer.content?.tvSecondaryNavRenderer) {
        const tabs = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections;
        if (LOG_WATCHED && DEBUG_ENABLED) {    
          console.log('[LIBRARY] Has', tabs?.length || 0, 'tab sections');
        }
      }
      
      if (r.contents.tvBrowseRenderer.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer) {
        const shelves = r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
        if (LOG_WATCHED && DEBUG_ENABLED) {    
          console.log('[LIBRARY] Main view has', shelves?.length || 0, 'shelves');
        }
      }
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[LIBRARY] ========================================');
      }
  }

  // ⭐ FIXED: Removed redundant window.location.hash.includes('list=') check
  // We already know the page type from getCurrentPage()
  //if (r?.contents?.singleColumnBrowseResultsRenderer && window.location.hash.includes('list=')) {
  if (r?.contents?.singleColumnBrowseResultsRenderer) {
    const page = getCurrentPage();
    
    // Only process if it's actually a playlist page
    if (page === 'playlist') {
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[PLAYLIST] ========================================');
        console.log('[PLAYLIST] Entered playlist');
        console.log('[PLAYLIST] Page:', page);
      }
      
      const tabs = r.contents.singleColumnBrowseResultsRenderer.tabs;
      if (tabs) {
        tabs.forEach((tab, idx) => {
          if (tab.tabRenderer?.content?.sectionListRenderer?.contents) {
            if (LOG_WATCHED && DEBUG_ENABLED) {    
              console.log(`[PLAYLIST] Tab ${idx} - processing shelves`);
            }
            processShelves(tab.tabRenderer.content.sectionListRenderer.contents);
          }
        });
      }
      if (LOG_WATCHED && DEBUG_ENABLED) {    
        console.log('[PLAYLIST] ========================================');
      }
    }
  }
  
  // Handle singleColumnBrowseResultsRenderer (alternative playlist format)
  if (r?.contents?.singleColumnBrowseResultsRenderer?.tabs) {
    const page = getCurrentPage();
    
    if (LOG_WATCHED && DEBUG_ENABLED) {
      console.log('[SINGLE_COLUMN] ========================================');
      console.log('[SINGLE_COLUMN] Page:', page);
      console.log('[SINGLE_COLUMN] Applying direct filtering...');
    }
    
    // Scan and filter ALL arrays
    scanAndFilterAllArrays(r.contents.singleColumnBrowseResultsRenderer, page);
    
    if (LOG_WATCHED && DEBUG_ENABLED) {
      console.log('[SINGLE_COLUMN] Direct filtering complete');
      console.log('[SINGLE_COLUMN] ========================================');
    }
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
    
    //if (DEBUG_ENABLED) {
      //console.log('[UNIVERSAL] ========================================');
      //console.log('[UNIVERSAL] Applying universal filtering to page:', currentPage);
    //}
    
    // Scan the ENTIRE response object and filter ALL video arrays
    scanAndFilterAllArrays(r, currentPage);
    
    //if (DEBUG_ENABLED) {
      //console.log('[UNIVERSAL] Universal filtering complete');
      //console.log('[UNIVERSAL] ========================================');
    //}
  }

  // ⭐ DIAGNOSTIC: Log ALL response structures for playlists
  if ((currentPage === 'playlist' || currentPage === 'playlists') && DEBUG_ENABLED) {
    //console.log('[PLAYLIST_DIAGNOSTIC] ========================================');
    //console.log('[PLAYLIST_DIAGNOSTIC] Response structure:');
    
    // Check all possible continuation structures
    if (r.continuationContents) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has continuationContents');
      console.log('[PLAYLIST_DIAGNOSTIC] continuationContents keys:', Object.keys(r.continuationContents));
    }
    
    if (r.onResponseReceivedActions) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has onResponseReceivedActions');
      console.log('[PLAYLIST_DIAGNOSTIC] Actions count:', r.onResponseReceivedActions.length);
      r.onResponseReceivedActions.forEach((action, idx) => {
        console.log(`[PLAYLIST_DIAGNOSTIC] Action ${idx} keys:`, Object.keys(action));
      });
    }
    
    if (r.onResponseReceivedEndpoints) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has onResponseReceivedEndpoints');
      console.log('[PLAYLIST_DIAGNOSTIC] Endpoints:', r.onResponseReceivedEndpoints.length);
    }
    
    if (r.contents) {
      console.log('[PLAYLIST_DIAGNOSTIC] ✓ Has contents');
      console.log('[PLAYLIST_DIAGNOSTIC] contents keys:', Object.keys(r.contents));
    }
    
    // Log if this is marked as processed
    if (r.__tizentubeProcessedPlaylist) {
      console.log('[PLAYLIST_DIAGNOSTIC] ⚠ Already marked as processed');
    }
    if (r.__universalFilterApplied) {
      //console.log('[PLAYLIST_DIAGNOSTIC] ⚠ Universal filter already applied');
    }
    
    //console.log('[PLAYLIST_DIAGNOSTIC] ========================================');
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
    console.warn('[SHELF_PROCESS] processShelves called with non-array', { type: typeof shelves });
    return;
  }
  
  const page = getCurrentPage();
  const shortsEnabled = configRead('enableShorts');
  const horizontalShelves = shelves.filter((shelve) => shelve?.shelfRenderer?.content?.horizontalListRenderer?.items);
  const hideWatchedEnabled = configRead('enableHideWatchedVideos');
  const configPages = configRead('hideWatchedVideosPages') || [];
  const shouldHideWatched = hideWatchedEnabled;
  
  if (DEBUG_ENABLED) {
    console.log('[SHELF] Page:', page, '| Shelves:', shelves.length, '| Hide watched:', shouldHideWatched, '| Shorts:', shortsEnabled);
  }

  if (window._lastLoggedPage !== page) {
    if (DEBUG_ENABLED) {
      console.log('[PAGE_DEBUG] ========================================');
      console.log('[PAGE_DEBUG] Page changed to:', page);
      console.log('[PAGE_DEBUG] URL:', window.location.href);
      console.log('[PAGE_DEBUG] Hash:', window.location.hash);
      console.log('$$$$$$$$$$$ Shorts enabled:', shortsEnabled);
      console.log('$$$$$$$$$$$ Total shelves:', shelves.length);
      console.log('[PAGE_DEBUG] ========================================');
    }
    window._lastLoggedPage = page;
  }

  // Lightweight diagnostics only (full per-shelf dumps are too slow on TV)
  if (DEBUG_ENABLED && (page === 'subscriptions' || page.includes('channel'))) {
    console.log('[SHELF_PROCESS] page=', page, '| shelves=', shelves.length, '| shortsEnabled=', shortsEnabled);
  }

  let totalItemsBefore = 0;
  let totalItemsAfter = 0;
  let shelvesRemoved = 0;
  let totalHidden = 0;
  let totalShortsRemoved = 0;
  
  for (let i = shelves.length - 1; i >= 0; i--) {
    try {
      const shelve = shelves[i];
      if (!shelve) continue;

      let shelfType = 'unknown';
      let itemsBefore = 0;
      let itemsAfter = 0;
      
      // Handle shelfRenderer
      if (shelve.shelfRenderer) {
        // horizontalListRenderer
        if (shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
          shelfType = 'hList';
          let items = shelve.shelfRenderer.content.horizontalListRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          itemsBefore = items.length;
          
          // ⭐ WATCHED FILTERING (always runs, independent of shorts)
          const beforeHide = items.length;
          if (shouldHideWatched) {
            items = hideVideo(items);
            totalHidden += (beforeHide - items.length);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
            items = originalItems;
          }
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.horizontalListRenderer.items = items;
          
          if (items.length === 0) {
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }
        
        // gridRenderer
        else if (shelve.shelfRenderer.content?.gridRenderer?.items) {
          shelfType = 'grid';
          let items = shelve.shelfRenderer.content.gridRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          itemsBefore = items.length;
          
          
          const beforeHide = items.length;
          if (shouldHideWatched) {
            items = hideVideo(items);
            totalHidden += (beforeHide - items.length);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
            items = originalItems;
          }
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.gridRenderer.items = items;
          
          if (items.length === 0) {
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }

        // verticalListRenderer
        else if (shelve.shelfRenderer.content?.verticalListRenderer?.items) {
          shelfType = 'vList';
          let items = shelve.shelfRenderer.content.verticalListRenderer.items;
          const originalItems = Array.isArray(items) ? items.slice() : [];
          itemsBefore = items.length;
          
          const beforeHide = items.length;
          if (shouldHideWatched) {
            items = hideVideo(items);
            totalHidden += (beforeHide - items.length);
          }
          if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
            if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
            items = originalItems;
          }
          itemsAfter = items.length;
          
          shelve.shelfRenderer.content.verticalListRenderer.items = items;
          
          if (items.length === 0) {
            if (DEBUG_ENABLED) {
              console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
            }
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }
      }
      
      // Handle richShelfRenderer (subscriptions)
      else if (shelve.richShelfRenderer?.content?.richGridRenderer?.contents) {
        shelfType = 'richGrid';
        let contents = shelve.richShelfRenderer.content.richGridRenderer.contents;
        const originalContents = Array.isArray(contents) ? contents.slice() : [];
        itemsBefore = contents.length;
        
        
        const beforeHide = contents.length;
        if (shouldHideWatched) {
          contents = hideVideo(contents);
          totalHidden += (beforeHide - contents.length);
        }
        if (shouldHideWatched && contents.length === 0 && originalContents.length > 0) {
          if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
          contents = originalContents;
        }
        itemsAfter = contents.length;
        
        shelve.richShelfRenderer.content.richGridRenderer.contents = contents;
        
        if (contents.length === 0) {
          if (DEBUG_ENABLED) {
            console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
          }
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }

      // Handle richSectionRenderer
      else if (shelve.richSectionRenderer?.content?.richShelfRenderer) {
        shelfType = 'richSec';
        
        if (!shortsEnabled) {
          const innerShelf = shelve.richSectionRenderer.content.richShelfRenderer;
          const contents = innerShelf?.content?.richGridRenderer?.contents;
          if (contents.length === 0) {
            if (DEBUG_ENABLED && LOG_SHORTS) {
              console.log('[SHELF_PROCESS] Removing shorts richSection shelf');
            }
            shelves.splice(i, 1);
            shelvesRemoved++;
            continue;
          }
        }
      }

      // Handle gridRenderer at shelf level
      else if (shelve.gridRenderer?.items) {
        shelfType = 'topGrid';
        let items = shelve.gridRenderer.items;
        const originalItems = Array.isArray(items) ? items.slice() : [];
        itemsBefore = items.length;
        
        
        const beforeHide = items.length;
        if (shouldHideWatched) {
          items = hideVideo(items);
          totalHidden += (beforeHide - items.length);
        }
        if (shouldHideWatched && items.length === 0 && originalItems.length > 0) {
          if (DEBUG_ENABLED) console.log('[SHELF_PROCESS] Watched filter would empty shelf; keeping original items to avoid black screen');
          items = originalItems;
        }
        itemsAfter = items.length;
        
        shelve.gridRenderer.items = items;
        
        if (items.length === 0) {
          if (DEBUG_ENABLED) {
            console.log('[SHELF_PROCESS] Shelf empty after filtering, removing');
          }
          shelves.splice(i, 1);
          shelvesRemoved++;
          continue;
        }
      }
      
      totalItemsBefore += itemsBefore;
      totalItemsAfter += itemsAfter;
      
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
      if (DEBUG_ENABLED) {
        console.log('[SHELF_CLEANUP] Removing empty shelf');
      }
      shelves.splice(i, 1);
    }
  }
  
  // Summary
  if (DEBUG_ENABLED) {
    console.log('[SHELF] Done:', totalItemsBefore, '→', totalItemsAfter, '| Hidden:', totalHidden, '| Shorts:', totalShortsRemoved, '| Removed:', shelvesRemoved, 'shelves');
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
let lastFullUrl = null;

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
  const fullUrl = location.href;
  const lastDetectedPage = window._lastDetectedPage;
  const lastFullUrl = window._lastFullUrl;
  
  if (detectedPage !== lastDetectedPage || fullUrl !== lastFullUrl) {
    if (DEBUG_ENABLED) {
      console.log(`[PAGE] ${lastDetectedPage||'initial'} → ${detectedPage}`);
      console.log(`[PAGE] Hash: "${cleanHash}"`);
      if (browseParam) console.log(`[PAGE] Browse param: "${browseParam}"`);
    }
    
    window._lastDetectedPage = detectedPage;
    window._lastFullUrl = fullUrl;
  }
  
  return detectedPage;
}