'use strict';
function calculateEMA(prices, period) {
  if (!Array.isArray(prices) || !prices.length) return 0;
  if (prices.length < period) return Number(prices.at(-1) || 0);
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + Number(b), 0) / period;
  for (let i = period; i < prices.length; i++) ema = Number(prices[i]) * k + ema * (1 - k);
  return ema;
}
module.exports = { calculateEMA };
