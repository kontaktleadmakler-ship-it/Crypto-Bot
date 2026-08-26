# JARVIS Event Bus 3.1

The JARVIS dashboard now has a central read-only event bus covering:

- SCAN:START / SCAN:COMPLETE
- AGENTS:EVALUATED
- RISK:EVALUATED
- DECISION:REPLAY
- SUPERVISOR:EVALUATED
- EXECUTION:STATE
- PORTFOLIO:SNAPSHOT
- RL:FEEDBACK
- SYSTEM:READY

## Endpoints

- `/api/dashboard/events?limit=80`
- `/api/dashboard/events/stream` (Server-Sent Events)

The event bus is observability-only. It cannot submit orders or promote models. Important governance events are appended to the existing append-only audit trail with throttling to prevent excessive disk writes.

The dashboard renders the event stream in the JARVIS Decision Intelligence console and receives new events through SSE while retaining polling as a fallback.
