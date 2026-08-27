'use strict';

function lastBarIndexAtOrBefore(bars, timestamp) {
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(Number(timestamp))) return -1;
  let lo = 0, hi = bars.length - 1, answer = -1;
  const target = Number(timestamp);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(bars[mid]?.time);
    if (!Number.isFinite(t)) { hi = mid - 1; continue; }
    if (t <= target) { answer = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return answer;
}
module.exports = { lastBarIndexAtOrBefore };
