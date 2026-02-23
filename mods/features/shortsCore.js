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
    if (lengthText) {
      const durationMatch = lengthText.match(/^(\d+):(\d+)$/);
      if (durationMatch) {
        const minutes = parseInt(durationMatch[1], 10);
        const seconds = parseInt(durationMatch[2], 10);
        const totalSeconds = minutes * 60 + seconds;        
        // Shorts can be nowt till 3min
        if (totalSeconds <= 180) {
          return true;
        }
      }
    }
  }
  return false;
}