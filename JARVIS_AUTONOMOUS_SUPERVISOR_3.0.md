# JARVIS Autonomous Supervisor 3.0

## Added
- Read-only supervisory layer over the existing agent network.
- Cross-agent conflict detection (including DQN vs final decision).
- Market breadth / extreme-move warnings.
- Portfolio/risk warning integration.
- Explainable decision path in the dashboard.
- Governance locks explicitly surfaced: execution, live orders, model promotion.
- Live endpoint: `/api/dashboard/supervisor?symbol=BTC-USDT`.

## Safety
The supervisor is observation/governance only. It does not submit orders, enable live execution, or promote models. Existing execution, risk, reconciliation, shadow and production gates remain authoritative.
