import asyncio
import logging
from market_data_handler import MarketDataFetcher

logger = logging.getLogger("scanner.core")

async def scan_pair(symbol: str, fetcher: MarketDataFetcher, dqn_agent: Any):
    # Fix: Aufruf des neuen Failsafe-Fetchers
    ohlcv = await fetcher.fetch_ohlcv_with_retry(symbol, timeframe="15m")
    if not ohlcv:
        logger.warning(f"[{symbol}] Überspringe Scan: Keine Kerzendaten verfügbar.")
        return None

    ob_metrics = await fetcher.get_orderbook_metrics(symbol)

    # Weiterverarbeitung im DQN-Agenten
    return dqn_agent.predict(ohlcv, ob_metrics)
