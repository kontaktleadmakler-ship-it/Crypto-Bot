'use strict';

function classifyCVD(trades = []) {
  let buy = 0, sell = 0;
  for (const t of trades) {
    const size = Number(t.size);
    if (!Number.isFinite(size) || size <= 0) continue;
    const side = String(t.side || '').toLowerCase();
    if (side === 'buy') buy += size;
    else if (side === 'sell') sell += size;
  }
  const delta = buy - sell;
  const total = buy + sell;
  return { buyVolume: buy, sellVolume: sell, delta, totalVolume: total, imbalance: total ? delta / total : 0 };
}

function evaluateMicrostructure({ orderBook = {}, trades = [], direction, spreadLimitPct = 0.15 } = {}) {
  const cvd = classifyCVD(trades);
  const spreadPct = Number(orderBook.spreadPct) || 0;
  const bidAskRatio = Number(orderBook.bidAskRatio) || 1;
  const directionCvdAligned = direction === 'LONG' ? cvd.delta >= 0 : direction === 'SHORT' ? cvd.delta <= 0 : true;
  const directionBookAligned = direction === 'LONG' ? bidAskRatio >= 1 : direction === 'SHORT' ? bidAskRatio <= 1 : true;
  const spreadOk = spreadPct <= spreadLimitPct;
  const score = Math.max(0, Math.min(100,
    50 + (directionCvdAligned ? Math.min(25, Math.abs(cvd.imbalance) * 50) : -20) +
    (directionBookAligned ? Math.min(15, Math.abs(Math.log(Math.max(bidAskRatio, 1e-9))) * 30) : -10) +
    (spreadOk ? 10 : -15)
  ));
  return { cvd, spreadPct, bidAskRatio, spreadOk, directionCvdAligned, directionBookAligned, score, veto: !spreadOk };
}

module.exports = { classifyCVD, evaluateMicrostructure };
