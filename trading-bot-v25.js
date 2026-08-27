'use strict';

/**
 * v25.0.5 institutional entrypoint.
 * The runtime is ESM while the surrounding project remains CommonJS.
 * Dynamic import avoids Node's MODULE_TYPELESS_PACKAGE_JSON reparsing warning
 * without globally switching package.json to "type": "module".
 */
import('./trading-bot-v24.6-runtime.js').catch((err) => {
  console.error('[BOOT] Runtime startup failed:', err);
  process.exitCode = 1;
});
