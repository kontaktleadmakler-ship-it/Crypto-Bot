'use strict';

/**
 * Bounded graceful shutdown helper.
 */
export async function gracefulShutdown({
  signal = 'SIGTERM',
  stopAccepting = async () => {},
  flush = async () => {},
  releaseLease = async () => {},
  closeResources = async () => {},
  timeoutMs = 10000,
  logger = console
} = {}) {
  logger.warn?.(`[SHUTDOWN] ${signal}`);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SHUTDOWN_TIMEOUT')), timeoutMs)
  );

  try {
    await stopAccepting();
    await Promise.race([flush(), timeout]);
  } catch (err) {
    logger.error?.(`[SHUTDOWN] flush failed: ${err.message}`);
  }

  try { await releaseLease(); }
  catch (err) { logger.error?.(`[SHUTDOWN] lease release failed: ${err.message}`); }

  try { await closeResources(); }
  catch (err) { logger.error?.(`[SHUTDOWN] resource close failed: ${err.message}`); }
}

export default gracefulShutdown;
