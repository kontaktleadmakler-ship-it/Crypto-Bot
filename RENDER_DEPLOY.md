# Render Deployment – v25

Build Command:
`npm install`

Start Command:
`npm start`

This launches:
`node trading-bot-v25.js`

Node version:
`22.x`

If Render still starts `node archive/legacy-bot-versions/trading-bot-v21.1-tfjs.js`, change the Render service's Start Command to `npm start`.

Do not enable live trading until production-readiness gates have passed.

## v25.0.16 Module-System Hotfix

The production entrypoint remains CommonJS and the institutional runtime/execution-core ESM files use the explicit `.mjs` extension. Do **not** add `"type": "module"` to this package. Render should use:

```bash
npm start
```

This prevents CommonJS modules such as `jarvis-event-bus.js` from being interpreted as ESM while keeping the runtime ESM-safe.

