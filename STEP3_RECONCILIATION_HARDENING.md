# Step 3 – Exchange / Ledger Reconciliation Hardening

## Startup invariant

`DB LOAD -> RESTORE PAPER/ACCOUNT LEDGER -> UNKNOWN/SUBMITTING DISCOVERY -> REMOTE SNAPSHOT -> LEDGER COMPARE -> RESUME/HALT`

No execution is allowed before the final reconciliation gate is healthy.

## Fail-closed rules

- Missing remote account/reconciliation APIs => HALT.
- Internal position without remote position => HALT.
- Remote position without internal position => HALT.
- Direction mismatch => HALT.
- Quantity mismatch outside tolerance => HALT.
- UNKNOWN order not resolved => HALT.
- Reconciliation exception => HALT.
- Reconciliation never submits, retries, cancels, or replaces an order.

## Paper mode

The current project remains paper-only. In `EXECUTION_MODE=paper`, the paper execution
adapter is treated as the remote ledger. A future account-enabled exchange adapter can
provide `getReconciliationSnapshot()` without changing the startup protocol.

## Live safety

The current KuCoin adapter intentionally has `accountData=false` and execution disabled.
If a non-paper mode is selected without an account-capable reconciliation adapter, startup
fails closed rather than pretending that exchange state was reconciled.
