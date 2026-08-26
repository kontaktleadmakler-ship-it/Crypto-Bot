/**
 * JARVIS Coin Forensics 6.9
 * Builds a decision lifecycle and links each decision to observed outcomes.
 * Read-only: never mutates execution or trading state.
 */
function pct(base, value) {
  const b = Number(base), v = Number(value);
  return Number.isFinite(b) && b > 0 && Number.isFinite(v) ? ((v - b) / b) * 100 : null;
}

function directed(reaction, action) {
  if (reaction == null) return null;
  const a = String(action || '').toUpperCase();
  if (a.includes('SHORT') || a.includes('SELL')) return -reaction;
  return reaction;
}

function buildCoinTimeline(events, symbol) {
  const sym = String(symbol || '').toUpperCase();
  const rows = events
    .filter(e => String(e.symbol || '').toUpperCase() === sym)
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

  const scans = rows.filter(e => e.type === 'SCAN:COIN');
  const out = [];

  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    const p = scan.payload || {};
    const relatedEnd = scans[i + 1]?.ts ?? Infinity;
    const related = rows.filter(e => Number(e.ts) >= Number(scan.ts) && Number(e.ts) < relatedEnd);

    const decision = [...related].reverse().find(e => ['DECISION:REPLAY', 'SUPERVISOR:EVALUATED'].includes(e.type));
    const agent = related.find(e => e.type === 'AGENTS:EVALUATED');
    const risk = related.find(e => e.type === 'RISK:EVALUATED');
    const execution = related.find(e => e.type === 'EXECUTION:STATE');

    const basePrice = Number(p.price || 0);
    const action = String(
      decision?.payload?.action ||
      decision?.payload?.finalAction ||
      decision?.payload?.recommendation ||
      p.gateDirection ||
      'REJECT'
    ).toUpperCase();

    // Forward outcomes are linked to the SAME decision using future scan indexes.
    const horizons = {};
    for (const h of [1, 3, 5, 10]) {
      const future = scans[i + h];
      if (!future) {
        horizons[`plus${h}Scan`] = null;
        continue;
      }
      const futurePrice = Number(future.payload?.price || 0);
      const reactionPct = pct(basePrice, futurePrice);
      horizons[`plus${h}Scan`] = {
        ts: future.ts,
        price: futurePrice,
        reactionPct,
        directedReactionPct: directed(reactionPct, action)
      };
    }

    // MFE/MAE over the next 10 observed scans, direction-adjusted.
    const futureScans = scans.slice(i + 1, i + 11);
    const futurePrices = futureScans.map(s => Number(s.payload?.price || 0)).filter(v => v > 0);
    let mfePct = null;
    let maePct = null;
    if (basePrice > 0 && futurePrices.length) {
      const raw = futurePrices.map(v => pct(basePrice, v));
      const isShort = action.includes('SHORT') || action.includes('SELL');
      const directedRaw = isShort ? raw.map(v => -v) : raw;
      mfePct = Math.max(...directedRaw);
      maePct = Math.min(...directedRaw);
    }

    const nextScan = scans[i + 1];
    const nextPrice = nextScan ? Number(nextScan.payload?.price || 0) : 0;
    const reactionPct = pct(basePrice, nextPrice);

    out.push({
      scanTs: scan.ts,
      scanCounter: p.scanCounter ?? null,
      symbol: sym,
      snapshot: p,
      agent: agent?.payload || null,
      risk: risk?.payload || null,
      decision: decision?.payload || null,
      execution: execution?.payload || null,
      action,
      confidence: Number(decision?.payload?.confidence ?? decision?.payload?.score ?? p.confidence ?? 0),
      nextObserved: nextScan ? { ts: nextScan.ts, price: nextPrice } : null,
      reactionPct,
      directedReactionPct: directed(reactionPct, action),
      outcomes: horizons,
      mfePct,
      maePct,
      outcomeQuality: horizons.plus10Scan?.directedReactionPct != null
        ? (horizons.plus10Scan.directedReactionPct > 0 ? 'POSITIVE' : 'NEGATIVE')
        : 'PENDING',
      eventCount: related.length
    });
  }

  return out;
}

module.exports = { buildCoinTimeline };
