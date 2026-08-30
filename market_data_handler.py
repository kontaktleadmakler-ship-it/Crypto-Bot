import asyncio
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger("scanner.market_data")

class MarketDataFetcher:
    """
    Robustes Market Data Modul mit automatischer Reconnection,
    Retry-Logik bei unvollständigen Kerzen & OrderBook-Fallback.
    """

    def __init__(self, exchange_client: Any, max_retries: int = 3):
        self.client = exchange_client
        self.max_retries = max_retries

    async def fetch_ohlcv_with_retry(self, symbol: str, timeframe: str = "15m", limit: int = 100) -> Optional[List[Any]]:
        """
        Holt OHLCV-Daten mit automatischer Retry-Logik und Fallback auf synthetische Kerzen.
        """
        for attempt in range(1, self.max_retries + 1):
            try:
                ohlcv = await self.client.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
                if ohlcv and len(ohlcv) > 0:
                    return ohlcv
                logger.warning(f"[{symbol}] Leere OHLCV-Antwort erhalten (Versuch {attempt}/{self.max_retries}).")
            except Exception as e:
                logger.warning(f"[{symbol}] Fehler beim Abrufen von {timeframe}-Daten: {e} (Versuch {attempt}/{self.max_retries})")
            
            await asyncio.sleep(0.5 * attempt)

        # Fallback: Versuch, 15m-Kerzen aus 5m-Kerzen zu synthetisieren
        if timeframe == "15m":
            logger.info(f"[{symbol}] Versuche Fallback auf 5m-Aggregat für 15m-Timeframe...")
            return await self._aggregate_from_lower_timeframe(symbol, base_tf="5m", target_multiplier=3, limit=limit * 3)

        logger.error(f"[{symbol}] Market-Data für {timeframe} nicht verfügbar.")
        return None

    async def _aggregate_from_lower_timeframe(self, symbol: str, base_tf: str, target_multiplier: int, limit: int) -> Optional[List[Any]]:
        try:
            raw_5m = await self.client.fetch_ohlcv(symbol, timeframe=base_tf, limit=limit)
            if not raw_5m or len(raw_5m) < target_multiplier:
                return None
            
            aggregated = []
            for i in range(0, len(raw_5m) - target_multiplier + 1, target_multiplier):
                chunk = raw_5m[i:i + target_multiplier]
                ts = chunk[0][0]
                open_p = chunk[0][1]
                high_p = max(c[2] for c in chunk)
                low_p = min(c[3] for c in chunk)
                close_p = chunk[-1][4]
                vol = sum(c[5] for c in chunk)
                aggregated.append([ts, open_p, high_p, low_p, close_p, vol])
            return aggregated
        except Exception as e:
            logger.error(f"[{symbol}] Fallback-Aggregation fehlgeschlagen: {e}")
            return None

    async def get_orderbook_metrics(self, symbol: str) -> Dict[str, float]:
        """
        Holt Orderbuch-Metriken mit stummer Fehlerbehandlung und sicheren Standardwerten.
        """
        default_metrics = {
            "bid_ask_spread": 0.001,
            "order_imbalance": 0.0,
            "depth_liquidity": 10000.0,
            "is_default": True
        }

        try:
            orderbook = await self.client.fetch_order_book(symbol, limit=20)
            if not orderbook or not orderbook.get("bids") or not orderbook.get("asks"):
                return default_metrics

            bids = orderbook["bids"]
            asks = orderbook["asks"]

            best_bid = bids[0][0]
            best_ask = asks[0][0]
            spread = (best_ask - best_bid) / best_bid if best_bid > 0 else 0.001

            bid_vol = sum(b[1] for b in bids[:10])
            ask_vol = sum(a[1] for a in asks[:10])
            total_vol = bid_vol + ask_vol
            imbalance = (bid_vol - ask_vol) / total_vol if total_vol > 0 else 0.0

            return {
                "bid_ask_spread": spread,
                "order_imbalance": imbalance,
                "depth_liquidity": total_vol,
                "is_default": False
            }
        except Exception as e:
            logger.debug(f"[{symbol}] OrderBook-Metriken nicht abrufbar, verwende Defaults: {e}")
            return default_metrics
