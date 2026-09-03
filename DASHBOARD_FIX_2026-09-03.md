# Dashboard Fix v25.0.19

## Fixed
- Footer navigation now targets complete dashboard panels instead of inner elements that could not scroll correctly.
- Neural Core is clickable and has an explicit `OPEN NEURAL TRACE / DECISION PIPELINE` action.
- Added a modal Neural Trace showing market input, technical/sentiment/ML/DQN/risk/supervisor/final-decision/outcome stages.
- Market rows are clickable and switch the selected symbol.
- Added visible closed paper-trade history backed by `/api/dashboard/execution` and `closedTrades`.
- Dashboard header P&L now displays realized + unrealized total P&L in USD when available, instead of treating dollar P&L as a percentage.
- Expanded the right dashboard column with its own scroll container so all forensic, neural, scan-history, portfolio, router and regime panels are reachable.
- Kept live order execution disabled; dashboard remains read-only/paper/shadow.
