# JARVIS 6.10 — Live Scanner Connection

The dashboard live market matrix and heatmap now consume `SCAN:COIN` events emitted by the production scanner.

Endpoints:
- `/api/dashboard/live-scanner` — current production-scanner snapshots
- `/api/dashboard/scan-history` — persisted historical `SCAN:COIN` events
- `/api/dashboard/coin-timeline` — coin lifecycle and observed outcomes

No parallel synthetic scanner is used for the live dashboard. If no production scan has emitted a snapshot yet, the UI shows WAITING rather than fabricated data.
