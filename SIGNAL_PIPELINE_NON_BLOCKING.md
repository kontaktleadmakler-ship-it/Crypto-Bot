# Signal Pipeline – Non-Blocking Hardening

## Ziel

Der Paper-Trading-Signalfluss ist jetzt strikt einseitig:

`Market Data -> Direction Gates -> ML -> Agent Suite -> DQN -> Final Risk -> Signal -> Paper Execution`

Ein abgelehntes Signal wird terminal verworfen und niemals an einen vorgelagerten Agenten zurückgesendet. Damit kann keine Agent/Risk-Rückkopplung entstehen.

## Änderungen

### 1. Pipeline-Tracking
Jeder Kandidat erhält eine Pipeline mit:
- `CANDIDATE`
- `PRE_RISK`
- `MARKET_DATA`
- `DIRECTION_GATE_PASSED`
- `POST_GATE`
- `ML_EVALUATING`
- `AGENTS_EVALUATING`
- `AGENTS_EVALUATED`
- `DQN_EVALUATING`
- `FINAL_RISK`
- `APPROVED`
- `SIGNAL_GENERATED`
- `EXECUTION_SUBMITTING`
- `EXECUTED`
- `REJECTED` / `ERROR`

Die letzten Pipeline-Schritte werden in den Live-Dashboard-Snapshot geschrieben und als `SIGNAL:PIPELINE` Event veröffentlicht.

### 2. Agent Supervisor
Der Meta Supervisor darf nur noch explizite Hard-Safety-Bedingungen als Hard Block melden.

- Kill Switch / Circuit Breaker / Exposure / Drawdown / Daily Loss bleiben Hard Safety.
- Schlechte Strategiegesundheit und schlechte Liquidität sind nur noch advisory und können die Konfidenz bzw. spätere Risk-Entscheidung beeinflussen.
- Die finale Autorität bleibt die `RiskEngine`.

### 3. Agent Timeout
Die Agent Suite läuft über einen 3-Sekunden-Watchdog. Ein hängender zukünftiger Agent kann dadurch nicht die gesamte Candidate-Pipeline offenhalten.

### 4. Execution UNKNOWN
Ein einzelner `UNKNOWN`-Paper-Execution-State setzt nicht mehr unmittelbar `isPaused = true` für den gesamten Scanner. Der Kandidat wird beendet und die Reconciliation bleibt fail-closed. Eine spätere Reconciliation kann weiterhin den Gesamtbetrieb anhalten, wenn die Ledger-Konsistenz tatsächlich verletzt ist.

### 5. Diagnostik
Zusätzliches Scan-Log:

`[SCAN-DIAGNOSTICS-PIPELINE] rejected=... timeouts=... stages=...`

Damit lässt sich unterscheiden, ob Signale an Risk, ML, Agenten, DQN oder Execution verloren gehen.

## Lock-Regel
Der bestehende `SymbolExecutionLock` bleibt ausschließlich auf die Ausführung pro Symbol beschränkt. Agenten- und Risk-Evaluation laufen nicht innerhalb dieses Execution-Locks.

## Tests

Neu:
- `tests/signal-pipeline-controller.test.js`

Bestehende Hardening-/Agent-/Lock-Tests bleiben erfolgreich.
