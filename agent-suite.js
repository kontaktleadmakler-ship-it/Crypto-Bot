'use strict';

/**
 * Institutional Agent Suite
 * All agents are evaluators. None can place live orders or override hard risk limits.
 */

function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : 0)); }
function num(v, d = 0) { return Number.isFinite(Number(v)) ? Number(v) : d; }

class RiskSupervisorAgent {
  evaluate(ctx = {}) {
    const exposure = num(ctx.exposurePct);
    const maxExposure = num(ctx.maxExposurePct, 100);
    const drawdown = Math.abs(num(ctx.drawdownPct));
    const maxDrawdown = num(ctx.maxDrawdownPct, 100);
    const dailyLoss = Math.abs(num(ctx.dailyLossPct));
    const maxDailyLoss = num(ctx.maxDailyLossPct, 100);
    const anomaly = clamp(ctx.anomalyScore);
    const liquidity = clamp(ctx.liquidityScore, 0, 1);
    const hardBlock = ctx.killSwitch === true || ctx.circuitBreaker === true || exposure > maxExposure || drawdown > maxDrawdown || dailyLoss > maxDailyLoss;
    let score = 1;
    score -= clamp(exposure / Math.max(maxExposure, 0.0001)) * 0.35;
    score -= clamp(drawdown / Math.max(maxDrawdown, 0.0001)) * 0.25;
    score -= clamp(dailyLoss / Math.max(maxDailyLoss, 0.0001)) * 0.20;
    score -= anomaly * 0.10;
    score -= (1 - liquidity) * 0.10;
    const decision = hardBlock ? 'BLOCK' : score >= 0.70 ? 'ALLOW' : score >= 0.45 ? 'REDUCE' : 'BLOCK';
    return { agent: 'risk-supervisor', decision, score: clamp(score), hardBlock, reasons: { exposure, drawdown, dailyLoss, anomaly, liquidity } };
  }
}

class PortfolioAllocationAgent {
  evaluate(ctx = {}) {
    const assets = Array.isArray(ctx.assets) ? ctx.assets : [];
    const maxExposure = num(ctx.maxPortfolioExposurePct, 100);
    const total = assets.reduce((s, a) => s + Math.max(0, num(a.requestedWeightPct)), 0);
    const scale = total > maxExposure && total > 0 ? maxExposure / total : 1;
    const allocations = assets.map(a => ({ symbol: a.symbol, requestedWeightPct: num(a.requestedWeightPct), approvedWeightPct: Math.max(0, num(a.requestedWeightPct)) * scale }));
    return { agent: 'portfolio-allocation', scale, allocations, concentration: allocations.length ? Math.max(...allocations.map(a => a.approvedWeightPct)) : 0 };
  }
}

class AnomalyDetectionAgent {
  evaluate(ctx = {}) {
    const spread = Math.abs(num(ctx.spreadPct));
    const slippage = Math.abs(num(ctx.slippagePct));
    const latency = Math.max(0, num(ctx.apiLatencyMs));
    const candleDelay = Math.max(0, num(ctx.candleDelayMs));
    const baselineSpread = Math.max(num(ctx.baselineSpreadPct, 0.05), 0.000001);
    const score = clamp((spread / baselineSpread - 1) * 0.30 + slippage * 0.20 + latency / 5000 * 0.20 + candleDelay / 60000 * 0.30);
    const severity = score >= 0.75 ? 'HIGH' : score >= 0.45 ? 'MEDIUM' : 'LOW';
    return { agent: 'anomaly-detection', score, severity, anomalies: { spread, slippage, latency, candleDelay } };
  }
}

class LiquidityAgent {
  evaluate(ctx = {}) {
    const spread = Math.abs(num(ctx.spreadPct));
    const depth = Math.max(0, num(ctx.depthUSD));
    const orderSize = Math.max(0, num(ctx.orderSizeUSD));
    const spreadScore = 1 - clamp(spread / Math.max(num(ctx.maxSpreadPct, 1), 0.0001));
    const depthScore = orderSize > 0 ? clamp(depth / (orderSize * Math.max(num(ctx.depthMultiple, 5), 1))) : 1;
    const score = clamp(spreadScore * 0.55 + depthScore * 0.45);
    return { agent: 'liquidity', score, decision: score >= 0.70 ? 'GOOD' : score >= 0.45 ? 'DEGRADED' : 'BLOCK', spreadPct: spread, depthUSD: depth };
  }
}

class ExitEvaluationAgent {
  evaluate(ctx = {}) {
    const pnl = num(ctx.unrealizedPnlPct);
    const holding = Math.max(0, num(ctx.holdingMinutes));
    const maxHolding = Math.max(num(ctx.maxHoldingMinutes, 1440), 1);
    const distanceToStop = num(ctx.distanceToStopPct, 1);
    const distanceToTarget = num(ctx.distanceToTargetPct, 1);
    let score = 0.5;
    if (pnl > 0) score += 0.20;
    if (pnl < 0) score -= 0.15;
    if (holding / maxHolding > 0.8) score += 0.15;
    if (distanceToStop <= 0) score += 0.50;
    if (distanceToTarget <= 0) score += 0.35;
    const decision = score >= 0.80 ? 'EXIT' : score >= 0.65 ? 'REDUCE' : 'HOLD';
    return { agent: 'exit-evaluation', decision, score: clamp(score), pnlPct: pnl, holdingMinutes: holding };
  }
}

class StrategyEvaluationAgent {
  evaluate(ctx = {}) {
    const expectancy = num(ctx.expectancy);
    const sharpe = num(ctx.sharpe);
    const drawdown = Math.abs(num(ctx.drawdownPct));
    const oos = clamp(ctx.oosScore, 0, 1);
    const drift = clamp(ctx.driftScore, 0, 1);
    const score = clamp(0.30 * clamp((expectancy + 1) / 2) + 0.20 * clamp((sharpe + 1) / 3) + 0.20 * (1 - clamp(drawdown / 30)) + 0.20 * oos + 0.10 * (1 - drift));
    const health = score >= 0.75 ? 'HEALTHY' : score >= 0.50 ? 'DEGRADED' : score >= 0.30 ? 'UNSTABLE' : 'DISABLED';
    return { agent: 'strategy-evaluation', score, health, inputs: { expectancy, sharpe, drawdown, oos, drift } };
  }
}

class MetaSupervisorAgent {
  evaluate(results = {}) {
    const risk = results.riskSupervisor?.score ?? 0;
    const liquidity = results.liquidity?.score ?? 0;
    const anomaly = results.anomaly?.score ?? 0;
    const strategy = results.strategy?.score ?? 0;
    const regime = clamp(results.regime?.confidence ?? results.regime?.score ?? 0.5);
    const hardBlock = results.riskSupervisor?.hardBlock === true;
    const confidence = clamp(risk * 0.35 + liquidity * 0.15 + (1 - anomaly) * 0.15 + strategy * 0.25 + regime * 0.10);
    // Supervisory confidence is advisory. Only explicit hard-safety conditions
    // are allowed to veto the pipeline here. Strategy health/liquidity quality
    // can reduce confidence, but the authoritative RiskEngine performs the
    // final safety decision later with the actual proposed position.
    const decision = hardBlock ? 'NO_TRADE' : confidence >= 0.70 ? 'PAPER_OK' : confidence >= 0.50 ? 'REDUCE_RISK' : 'MONITOR';
    const advisoryBlocks = [];
    if (results.liquidity?.decision === 'BLOCK') advisoryBlocks.push('LIQUIDITY_DEGRADED');
    if (results.strategy?.health === 'DISABLED') advisoryBlocks.push('STRATEGY_HEALTH_DISABLED');
    return { agent: 'meta-supervisor', decision, confidence, hardBlock, advisoryOnly: !hardBlock, advisoryBlocks };
  }
}

class InstitutionalAgentSuite {
  constructor(options = {}) {
    this.riskSupervisor = new RiskSupervisorAgent(options.risk);
    this.portfolioAllocation = new PortfolioAllocationAgent(options.portfolio);
    this.anomalyDetection = new AnomalyDetectionAgent(options.anomaly);
    this.liquidity = new LiquidityAgent(options.liquidity);
    this.exitEvaluation = new ExitEvaluationAgent(options.exit);
    this.strategyEvaluation = new StrategyEvaluationAgent(options.strategy);
    this.metaSupervisor = new MetaSupervisorAgent(options.meta);
  }
  evaluate(ctx = {}) {
    const anomaly = this.anomalyDetection.evaluate(ctx);
    const liquidity = this.liquidity.evaluate(ctx);
    const risk = this.riskSupervisor.evaluate({ ...ctx, anomalyScore: anomaly.score, liquidityScore: liquidity.score });
    const portfolio = this.portfolioAllocation.evaluate(ctx);
    const exit = this.exitEvaluation.evaluate(ctx);
    const strategy = this.strategyEvaluation.evaluate(ctx);
    const meta = this.metaSupervisor.evaluate({ riskSupervisor: risk, anomaly, liquidity, strategy, regime: ctx.regime });
    return { riskSupervisor: risk, portfolioAllocation: portfolio, anomaly, liquidity, exit, strategy, meta };
  }
}

module.exports = { RiskSupervisorAgent, PortfolioAllocationAgent, AnomalyDetectionAgent, LiquidityAgent, ExitEvaluationAgent, StrategyEvaluationAgent, MetaSupervisorAgent, InstitutionalAgentSuite };
