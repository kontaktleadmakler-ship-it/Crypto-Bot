# Step 5 — Central Risk Governor

The RiskGovernor is the final global execution authority. States: NORMAL -> REDUCED -> HALT -> EMERGENCY. Automatic recovery is forbidden. HALT/EMERGENCY allow only risk-reducing CLOSE/REDUCE actions.

Controls: position/notional/order size, leverage/exposure, drawdown, daily loss, spread, slippage, market-data age, exchange latency, volatility, concentration and correlation thresholds.

All protected execution calls pass through the governor. Runtime entry is blocked in HALT/EMERGENCY and reduced-risk mode requires explicit reduced sizing.
