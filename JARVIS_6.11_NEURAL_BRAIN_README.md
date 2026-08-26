# JARVIS 6.11 — Neural Brain Command Center

## What changed

- Dashboard remains connected to the production scanner endpoints already present in the bot.
- Live market data continues to come from `/api/dashboard/live-scanner` and scanner state from `/api/dashboard/scan`.
- SSE `/api/dashboard/events/stream` continues to trigger live refreshes.
- Historical data remains connected to `/api/dashboard/coin-timeline` and `/api/dashboard/scan-history`.
- Added a pure Canvas 3D-projected neural-brain visualization; no new browser runtime dependency is required.
- The brain continuously rotates in pseudo-3D and renders the live feature/agent network.
- Every visible decision is linked from market-data origins to the decision core and onward to observed +1/+3/+5/+10 scan outcomes.
- Historical decision traces remain visible as faded links so the graph represents decision lineage rather than a decorative animation.
- Positive observed outcomes glow green, negative outcomes red, and pending outcomes gold.
- Build endpoint now reports `JARVIS-NEURAL-BRAIN-6.11`.

## Deployment

Keep the existing Render start command:

```text
npm start
```

which runs the existing production entry point:

```text
node trading-bot-v25.js
```

No exchange API keys need to be moved into the browser.

After deployment, verify:

```text
/dashboard
/api/dashboard/build
```

Expected build identifier:

```text
JARVIS-NEURAL-BRAIN-6.11
```

## Data integrity

The 3D brain does not fabricate market or outcome data. It renders the data already returned by the production dashboard endpoints. If a forward outcome is not yet available, the corresponding node remains `PENDING`.
