import asyncio
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("neural_core.signal_engine")

class SignalEngine:
    def __init__(self, buffer_size: int = 1000):
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=buffer_size)
        self.is_running: bool = False
        self._worker_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        self.is_running = True
        self._worker_task = asyncio.create_task(self._process_queue())
        logger.info("SignalEngine erfolgreich gestartet (Async Queue active).")

    async def push_tick(self, tick_data: Dict[str, Any]) -> None:
        if not self.is_running:
            return
        
        # Non-blocking enqueue logic to prevent main thread stall
        if self.queue.full():
            try:
                _ = self.queue.get_nowait() # Drop oldest tick under extreme load
                logger.warning("Queue overflow: Dropped oldest tick buffer.")
            except asyncio.QueueEmpty:
                pass
        
        await self.queue.put(tick_data)

    async def _process_queue(self) -> None:
        while self.is_running:
            try:
                tick = await self.queue.get()
                signal = await self._evaluate_signal(tick)
                if signal:
                    await self._dispatch_signal(signal)
                self.queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Fehler in Signalverarbeitung: {e}", exc_info=True)
                await asyncio.sleep(0.05)

    async def _evaluate_signal(self, tick: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        score = tick.get("neural_score", 0.0)
        if score >= 0.85:
            return {
                "agent_id": tick.get("agent_id"),
                "action": "BUY" if tick.get("trend", 0) > 0 else "SELL",
                "confidence": score,
                "timestamp": tick.get("timestamp")
            }
        return None

    async def _dispatch_signal(self, signal: Dict[str, Any]) -> None:
        # Implementation of real-time signal dispatching to trading API & WebSocket WS bus
        pass

    async def stop(self) -> None:
        self.is_running = False
        if self._worker_task:
            self._worker_task.cancel()
            await asyncio.gather(self._worker_task, return_exceptions=True)
        logger.info("SignalEngine geordnet heruntergefahren.")
