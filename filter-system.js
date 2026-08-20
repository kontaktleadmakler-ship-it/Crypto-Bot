'use strict';

/**
 * Centralized directional filter evaluation.
 * // FIX: Disabled filters no longer affect either score or gate result.
 * // FIX: adaptiveADX/adaptiveVolume are read from the actual gate payload.
 */
function evaluateDirectionGates(dir, p, scanStats = {}, config, filterState) {
  const isLong = dir === 'LONG';
  const enabled = key => filterState?.[key]?.enabled !== false;
  const inc = key => { scanStats[key] = (scanStats[key] || 0) + 1; };

  if (enabled('trend4h') && config.REQUIRE_4H_TREND) {
    const ok = isLong ? p.trend4h === 'BULLISH' : p.trend4h === 'BEARISH';
    if (!ok) return 'trendMismatch4h';
  }
  const trend1hOk = isLong ? p.trend1h === 'BULLISH' : p.trend1h === 'BEARISH';
  if (!trend1hOk) return 'trendMismatch1h';

  if (enabled('btctrend') && !config.ALLOW_COUNTER_BTC_TREND) {
    const against = (p.btcTrend === 'BEARISH' && isLong) || (p.btcTrend === 'BULLISH' && !isLong);
    if (against) return 'btcCounterTrendBlocked';
  }

  if (enabled('bos')) {
    const ok = isLong ? p.bosBullish : p.bosBearish;
    if (!ok) return 'noBOS';
  }

  const fundingOk = isLong ? p.fundingRate <= config.MAX_FUNDING_RATE : p.fundingRate >= config.MIN_FUNDING_RATE;
  if (!fundingOk) return 'fundingBlocked';

  let score = 0, max = 0;

  // FIX: adaptive values come from p.adaptiveADX / p.adaptiveVolume.
  const effectiveADX = Number.isFinite(Number(p.adaptiveADX)) ? Number(p.adaptiveADX) : config.ADX_MIN;
  const effectiveVolume = Number.isFinite(Number(p.adaptiveVolume)) ? Number(p.adaptiveVolume) : config.MIN_RELATIVE_VOLUME;

  if (enabled('adx') || enabled('hurst') || enabled('chop')) {
    let trendRaw = 0, trendWeightSum = 0;
    if (enabled('adx')) { trendRaw += Math.max(0, Math.min(1, p.adx / 100)) * 0.5; trendWeightSum += 0.5; }
    if (enabled('hurst')) { trendRaw += Math.max(0, Math.min(1, p.hurst)) * 0.3; trendWeightSum += 0.3; }
    if (enabled('chop')) { trendRaw += Math.max(0, Math.min(1, (100 - p.chop) / 100)) * 0.2; trendWeightSum += 0.2; }
    if (trendWeightSum > 0) {
      max += 50;
      score += 50 * (trendRaw / trendWeightSum);
      if ((enabled('adx') && p.adx < effectiveADX) || (enabled('hurst') && p.hurst < config.MIN_HURST_EXPONENT) ||
          (enabled('chop') && p.chop > config.MAX_CHOP_INDEX)) inc('trendQualityLow');
    }
  }

  if (enabled('rsi_long_min') || enabled('rsi_short_max')) {
    max += 20;
    const rsiMinOk = isLong ? (!enabled('rsi_long_min') || p.rsi >= config.RSI_LONG_MIN) : (!enabled('rsi_short_max') || p.rsi >= config.RSI_SHORT_MIN);
    const rsiMaxOk = isLong ? p.rsi <= config.RSI_LONG_MAX : (!enabled('rsi_short_max') || p.rsi <= config.RSI_SHORT_MAX);
    const rsiInZone = rsiMinOk && rsiMaxOk;
    if (rsiInZone) score += 20;
    else inc(isLong ? 'rsiTooLow' : 'rsiTooHigh');
  }

  // FIX: POC/VWAP is skipped entirely when the user disables it.
  if (enabled('pocvwap')) {
    max += 10;
    const priceOk = p.poc != null && p.vwap != null &&
      (isLong ? p.currentPrice >= p.poc && p.currentPrice >= p.vwap : p.currentPrice <= p.poc && p.currentPrice <= p.vwap);
    if (priceOk) score += 10; else inc('pocVwapFail');
  }

  // FIX: MACD is skipped entirely when disabled.
  if (enabled('macd')) {
    max += 10;
    const macdOk = isLong ? p.macd?.histogram >= 0 : p.macd?.histogram <= 0;
    if (macdOk) score += 10; else inc('macdFail');
  }

  if (enabled('relvol')) {
    max += 10;
    if (effectiveVolume <= 0 || p.relativeVolume >= effectiveVolume) score += 10;
    else { score += Math.max(0, 10 * (p.relativeVolume / effectiveVolume)); inc('relVolTooLow'); }
  }

  const gateScore = max > 0 ? Math.round(100 * score / max) : 100;
  if (gateScore < config.MIN_GATE_SCORE) return 'lowConfluenceScore';
  return null;
}

function selectDirection({ primaryDir, gateParams, scanStats, config, filterState }) {
  const primaryFail = evaluateDirectionGates(primaryDir, gateParams, scanStats, config, filterState);
  if (!primaryFail) return { direction: primaryDir, failure: null };

  // FIX: A SHORT candidate is never evaluated when ENABLE_SHORT_SIGNALS=false.
  const secondaryDir = primaryDir === 'LONG' ? 'SHORT' : 'LONG';
  if (secondaryDir === 'SHORT' && config.ENABLE_SHORT_SIGNALS !== true) {
    scanStats[primaryFail] = (scanStats[primaryFail] || 0) + 1;
    return { direction: null, failure: primaryFail };
  }

  const secondaryFail = evaluateDirectionGates(secondaryDir, gateParams, scanStats, config, filterState);
  if (!secondaryFail) return { direction: secondaryDir, failure: null };
  scanStats[primaryFail] = (scanStats[primaryFail] || 0) + 1;
  return { direction: null, failure: primaryFail };
}

module.exports = { evaluateDirectionGates, selectDirection };
