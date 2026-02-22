// KrX If removed, breaks playlist filtering, subscription and channel watched viltering and shorts removal + watch page removal
export function shouldFilterShorts(shortsEnabled, page) {
  return !shortsEnabled && page !== 'playlist' && page !== 'playlists';
}


export function filterShortItems(items, { page, debugEnabled = false, logShorts = false } = {}) {
  if (!Array.isArray(items)) return { items: [], removed: 0 };
  const filtered = items.filter((item) => !isShortItem(item, { debugEnabled, logShorts, currentPage: page || 'other' }));
  return { items: filtered, removed: items.length - filtered.length };
}

//KrX if removed breaks suscription, library all videos ar removed and hsorts on home page only 3 shelfs remain, so filters everything
export function isShortItem(item, { debugEnabled = false, logShorts = false, currentPage = '' } = {}) {
  if (!item) return false;

  const videoId = item.tileRenderer?.contentId ||
    item.videoRenderer?.videoId ||
    item.gridVideoRenderer?.videoId ||
    item.compactVideoRenderer?.videoId ||
    'unknown';

  const page = currentPage || 'other';

  if ((page === 'subscriptions' || String(page).includes('channel')) && debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] checking', videoId);
  }

  if (item.tileRenderer?.contentType === 'TILE_CONTENT_TYPE_SHORT') return true;

  if (item.videoRenderer) {
    const overlays = item.videoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const navEndpoint = item.videoRenderer.navigationEndpoint;
    if (navEndpoint?.reelWatchEndpoint) return true;
    const url = navEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.gridVideoRenderer) {
    const overlays = item.gridVideoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const url = item.gridVideoRenderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.compactVideoRenderer) {
    const overlays = item.compactVideoRenderer.thumbnailOverlays || [];
    if (overlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS')) return true;

    const url = item.compactVideoRenderer.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
    if (url.includes('/shorts/')) return true;
  }

  if (item.tileRenderer?.onSelectCommand?.reelWatchEndpoint) return true;

  if (item.tileRenderer?.onSelectCommand) {
    const cmdStr = JSON.stringify(item.tileRenderer.onSelectCommand);
    if (cmdStr.includes('reelWatch') || cmdStr.includes('/shorts/')) return true;
  }

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnailOverlays) {
    const hasShortsBadge = item.tileRenderer.header.tileHeaderRenderer.thumbnailOverlays.some((overlay) =>
      overlay.thumbnailOverlayTimeStatusRenderer?.style === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.simpleText === 'SHORTS' ||
      overlay.thumbnailOverlayTimeStatusRenderer?.text?.runs?.some((run) => run.text === 'SHORTS')
    );
    if (hasShortsBadge) return true;
  }

  const videoTitle = item.tileRenderer?.metadata?.tileMetadataRenderer?.title?.simpleText || '';
  if (videoTitle.toLowerCase().includes('#shorts') || videoTitle.toLowerCase().includes('#short')) return true;

  if (item.tileRenderer) {
    let lengthText = null;
    const thumbnailOverlays = item.tileRenderer.header?.tileHeaderRenderer?.thumbnailOverlays;
    if (thumbnailOverlays && Array.isArray(thumbnailOverlays)) {
      const timeOverlay = thumbnailOverlays.find((o) => o.thumbnailOverlayTimeStatusRenderer);
      if (timeOverlay) {
        lengthText = timeOverlay.thumbnailOverlayTimeStatusRenderer.text?.simpleText;
      }
    }

    if (!lengthText) {
      lengthText = item.tileRenderer.metadata?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.find(
        (i) => i.lineItemRenderer?.badge || i.lineItemRenderer?.text?.simpleText
      )?.lineItemRenderer?.text?.simpleText;
    }

    if (lengthText) {
      const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
      if (durationMatch) {
        const minutes = parseInt(durationMatch[1], 10);
        const seconds = parseInt(durationMatch[2], 10);
        const totalSeconds = minutes * 60 + seconds;
        if (totalSeconds <= 90) {
          if (debugEnabled && logShorts) {
            console.log('[SHORTS] Detected by duration (≤ 90s):', videoId, '| Duration:', totalSeconds + 's');
          }
          return true;
        }
        
        // Extended check for 90-180 seconds Shorts can be nowt till 3min
        if (totalSeconds <= 180) {
          if (debugEnabled && logShorts) {
            console.log('[SHORTS] Detected by duration + shelf memory:', videoId, '| Duration:', totalSeconds + 's');
          }
          return true;
        }
      }
    }
  }

  if (item.richItemRenderer?.content?.reelItemRenderer) return true;

  if (item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
    const thumb = item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails[0];
    if (thumb && thumb.height > thumb.width) return true;
  }

  if (debugEnabled && logShorts) {
    console.log('[SHORTS_DIAGNOSTIC] not short', videoId);
  }
  return false;
}