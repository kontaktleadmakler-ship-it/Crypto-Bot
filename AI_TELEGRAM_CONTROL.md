# AI Telegram Control Center — v22.2.1 PRO

## Agenten
- `/agents` — Status aller 10 Agents
- `/agent <name>` — Detailstatus eines Agents
- `/agent_on <name>` / `/agent_off <name>` — Agent aktivieren/deaktivieren
- `/agents_on` / `/agents_off` — alle Agents schalten
- `/agent_weights` — aktuelle Gewichtung

Namen/Aliase: `regime`, `critic`, `risk`, `confluence`, `macro`, `liquidity`, `volatility`, `anomaly`, `portfolio`, `execution`.

## LLM
- `/llm_status` — Verfügbarkeit und Modell
- `/llm_on` — LLM Reviewer aktivieren, wenn `GEMINI_API_KEY` vorhanden
- `/llm_off` — LLM Reviewer deaktivieren
- `/llm_test` — sicheren Test-Review ausführen

## Analyse & Monitoring
- `/signals`
- `/signal <symbol>`
- `/explain <symbol>`
- `/confluence <symbol>`
- `/risk`
- `/regime`
- `/anomalies`
- `/status`, `/scan`, `/scanstats`, `/stats`, `/week`, `/month`

## Sicherheit
- `/pause` / `/resume`
- `/kill_status`

LLM und Agents haben keine Berechtigung, RiskEngine, Kill-Switch oder Execution-Sicherheitsregeln zu umgehen. Live-Execution bleibt standardmäßig deaktiviert (`EXECUTION_ENABLED=false`, `DRY_RUN=true`).

## AI Hardening Commands
- `/ai_hardening` — Status von DataFusion, Arbitration, Portfolio-Risk, Walk-Forward, Drift und Attribution
- `/drift` — Model/Feature Drift Status
- `/agent_attribution` — Agent-Beitrag, Vetos und durchschnittlicher PnL
- `/agent_stats` — Alias für Attribution
