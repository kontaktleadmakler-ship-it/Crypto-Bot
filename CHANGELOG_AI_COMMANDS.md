# Changelog — Multi-Agent + Telegram Control Center

## v22.2.1-AI-CONTROL
- 10 spezialisierte Agents: Regime, Signal Critic, Risk Sentinel, Confluence, News/Macro, Liquidity, Volatility, Anomaly, Portfolio, Execution.
- Gewichteter Agent-Orchestrator mit Fail-Closed-Agent-Fehlerbehandlung.
- Dynamisches Aktivieren/Deaktivieren einzelner Agents über Telegram.
- Telegram-Status und Gewichtungsanzeige.
- LLM Reviewer kann zur Laufzeit aktiviert/deaktiviert werden, sofern `GEMINI_API_KEY` vorhanden ist.
- LLM-Testcommand ohne Orderfreigabe.
- Safety: `/kill_status`, `/pause`, `/resume`.
- LLM bleibt Reviewer und darf RiskEngine/Kill-Switch nicht umgehen.
