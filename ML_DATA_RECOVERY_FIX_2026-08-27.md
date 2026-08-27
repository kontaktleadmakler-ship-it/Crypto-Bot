# ML Data Recovery Fix – 2026-08-27

## Problem

TensorFlow.js reported `raw=58`, `legacyEntryFallback=58`, but `valid=0/40`. The historical closed-trade records could lack `signalPriceAtEntry` and, in some generations, the entry price itself. The previous feature builder rejected every row when no price was available, even when the already-normalized entry features were complete.

## Fix

- `featuresFromTrade()` now uses `signalPriceAtEntry` first, then `entry`, then explicitly persisted legacy entry-price aliases.
- A price is no longer required when normalized features such as `atrPctAtEntry` and `macdHistogramPctAtEntry` are already persisted.
- A price remains mandatory when a non-zero raw ATR/MACD value must first be normalized.
- Training failure logs now report structured invalid-row reasons.
- Startup ML recovery v3 merges exact paper orders restored by the paper execution adapter with the `paperOrders` collection. This handles Render restarts where the adapter has recovered fills but the collection query is temporarily empty.
- No fabricated market features or PnL-derived indicators are generated.
- New trades continue to persist the complete entry-time feature snapshot and `signalPriceAtEntry`.

## Safety

This fix does not add live exchange order execution. The system remains paper/signal based.
