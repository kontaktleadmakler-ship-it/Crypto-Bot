# Security Contract

- Never commit `.env`, API keys, exchange secrets, Telegram tokens or model artifacts containing sensitive data.
- Operational API authentication is enabled by default.
- Health may be public only when `HEALTH_PUBLIC=true` is an explicit deployment decision.
- Backtest HTTP execution is disabled by default.
- Real-money execution is disabled by default and additionally requires the independent live execution gate.
- Rotate secrets through the deployment secret manager; do not place them in source code.
- Audit files and model registries should use persistent storage with restricted filesystem permissions.
