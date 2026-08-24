# v22.7 – Phase B11: Production Hardening

B11 adds the safety control plane around the existing Paper/Shadow system.

## Added

- `production-state-machine.js`
- `health-readiness-gates.js`
- `startup-reconciliation.js`
- `kill-switch-controller.js`
- `audit-trail.js`
- `failure-chaos-tests.js`
- `production-hardening-config.js`
- `tests/b11.test.js`

## State model

`STARTING -> PAPER/SHADOW`
`PAPER <-> SHADOW`
`PAPER/SHADOW -> DEGRADED/HALTED`
`HALTED -> STARTING` only after explicit reset.

## Fail-closed behavior

Unknown/missing readiness checks are not ready.
Startup reconciliation failure is unsafe.
Kill switch blocks new signals and moves the system to HALTED.

## Environment

- `TRADING_MODE=PAPER`
- `REQUIRE_STARTUP_RECONCILIATION=true`
- `REQUIRE_READINESS_GATES=true`
- `AUDIT_TRAIL_FILE=./data/audit/audit.jsonl`

No live order execution is added or enabled by B11.
