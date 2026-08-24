# v22.2.1 PRO — Data Quality & AI Hardening

## Neue Schichten
- DataFusion: normalisiert Candle-Formate, erkennt Stale/Gaps und liefert Quality Score.
- SignalArbitrator: letzte deterministische Freigabe zwischen Agents, DQN, Risk und optionalem LLM.
- PortfolioRiskAgent: Exposure, Korrelation und Same-Direction-Cap als zusätzliche harte Grenzen.
- WalkForwardEngine: rollierende Train/Test-Fenster für OOS-Validierung.
- ModelDriftMonitor: überwacht Feature-Distribution und meldet Drift.
- AgentAttribution: misst Agent-Scores, Vetos und späteren PnL-Beitrag.

## Sicherheitsprinzip
LLM bleibt Reviewer. RiskEngine/Kill-Switch und Data Quality können niemals durch das LLM überschrieben werden.

## Empfohlene Rollout-Reihenfolge
1. Data Quality/Fusion im Paper-Modus beobachten.
2. Walk-Forward + OOS als Gate vor Modelländerungen.
3. Agent Attribution sammeln.
4. Drift-Monitor zunächst nur alarmieren lassen.
5. Erst danach adaptive Agent-Gewichte aktivieren.
