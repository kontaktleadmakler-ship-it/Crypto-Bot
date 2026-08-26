# JARVIS 6.12 — Production Scanner Link

## Why 6.12 exists
The dashboard SSE endpoint emits named `jarvis` events (`event: jarvis`). The previous dashboard subscribed with `EventSource.onmessage`, which only receives unnamed SSE messages. As a result, the browser did not react to the production scanner event stream.

## Fix
- Dashboard subscribes with `addEventListener('jarvis', ...)`.
- `SCAN:COIN` payloads are merged directly into the live market matrix.
- Agent/Risk/Supervisor/Decision/Execution events trigger a debounced intelligence refresh.
- `/api/dashboard/connection` exposes production event-bus connectivity and current live scanner snapshots.
- Existing scanner and event bus remain the single source of truth; no synthetic dashboard scanner is introduced.
- Build ID: `JARVIS-NEURAL-BRAIN-6.12-PRODUCTION-LINK`.

## Render verification
After deployment:
- `/dashboard`
- `/api/dashboard/build`
- `/api/dashboard/connection`

`/api/dashboard/connection` should report `source: PRODUCTION_SCANNER_EVENT_BUS` and show live coins after the next scanner evaluation.
