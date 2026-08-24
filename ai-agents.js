'use strict';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

class BaseAgent {
  constructor({ name, logger }) {
    this.name = name;
    this.logger = logger;
  }

  result(overrides = {}) {
    return {
      agent: this.name,
      score: 0,
      confidence: 0,
      veto: false,
      reasons: [],
      ...overrides
    };
  }
}

class MarketRegimeAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'market-regime-agent' }); }
  evaluate(ctx) {
    const phase = ctx.marketPhase;
    const adx = Number(ctx.adx || 0);
    const atrPct = Number(ctx.atrPct || 0);
    let score = 0.5;
    const reasons = [];
    if (phase === 'TRENDING') { score += 0.22; reasons.push('trend-regime'); }
    if (phase === 'RANGING') { score -= 0.10; reasons.push('range-regime'); }
    if (phase === 'VOLATILE') { score -= 0.04; reasons.push('high-volatility'); }
    if (adx >= 25) { score += 0.08; reasons.push('adx-confirmed'); }
    if (atrPct > 5) { score -= 0.12; reasons.push('extreme-atr'); }
    return this.result({ score: clamp(score), confidence: clamp(0.55 + Math.min(adx, 40) / 100), reasons });
  }
}

class SignalCriticAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'signal-critic-agent' }); }
  evaluate(ctx) {
    const reasons = [];
    let score = 0.5;
    const dir = ctx.direction;
    if (dir === 'LONG' && ctx.trend1h === 'BULLISH') { score += 0.16; reasons.push('1h-aligned'); }
    if (dir === 'SHORT' && ctx.trend1h === 'BEARISH') { score += 0.16; reasons.push('1h-aligned'); }
    if (dir === 'LONG' && ctx.trend4h === 'BEARISH') { score -= 0.18; reasons.push('4h-conflict'); }
    if (dir === 'SHORT' && ctx.trend4h === 'BULLISH') { score -= 0.18; reasons.push('4h-conflict'); }
    if (Number(ctx.signalScore) >= 75) { score += 0.18; reasons.push('strong-score'); }
    else if (Number(ctx.signalScore) < 60) { score -= 0.18; reasons.push('weak-score'); }
    if (Number(ctx.mlProbability) >= 0.70) { score += 0.10; reasons.push('ml-confirmed'); }
    if (Number(ctx.mlProbability) > 0 && Number(ctx.mlProbability) < 0.55) { score -= 0.15; reasons.push('ml-weak'); }
    if (Math.abs(Number(ctx.cvdScore || 50) - 50) < 5) { score -= 0.04; reasons.push('cvd-neutral'); }
    return this.result({ score: clamp(score), confidence: clamp(0.58 + Math.min(Number(ctx.signalScore || 0), 100) / 250), reasons });
  }
}

class RiskSentinelAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'risk-sentinel-agent' }); }
  evaluate(ctx) {
    const reasons = [];
    let score = 0.82;
    let veto = false;
    const dailyPnl = Number(ctx.dailyPnL || 0);
    const maxLoss = Math.abs(Number(ctx.maxDailyLossUSD || 0));
    const exposure = Number(ctx.exposureRatio || 0);
    const spread = Number(ctx.spreadPct || 0);
    if (maxLoss > 0 && dailyPnl <= -0.75 * maxLoss) { score -= 0.30; reasons.push('daily-loss-near-limit'); }
    if (maxLoss > 0 && dailyPnl <= -0.95 * maxLoss) { veto = true; reasons.push('daily-loss-critical'); }
    if (exposure > 0.85) { score -= 0.25; reasons.push('high-exposure'); }
    if (exposure > 0.98) { veto = true; reasons.push('exposure-critical'); }
    if (spread > 0.40) { score -= 0.15; reasons.push('wide-spread'); }
    return this.result({ score: clamp(score), confidence: 0.85, veto, reasons });
  }
}

class ConfluenceAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'confluence-agent' }); }
  evaluate(ctx) {
    const reasons = [];
    let score = 0.5;
    const confluence = Number(ctx.confluenceScore || 0);
    const ichimoku = Number(ctx.ichimokuScore || 0);
    const volumeMacd = Number(ctx.volumeMACDScore || 0);
    const cvd = Number(ctx.cvdScore || 50);
    score += (confluence - 50) / 180;
    score += (ichimoku - 50) / 240;
    score += (volumeMacd - 50) / 240;
    score += (cvd - 50) / 300;
    if (confluence >= 70) reasons.push('mtf-confluence');
    if (ichimoku >= 65) reasons.push('ichimoku-aligned');
    if (volumeMacd >= 65) reasons.push('volume-macd-aligned');
    if ((ctx.direction === 'LONG' && cvd >= 60) || (ctx.direction === 'SHORT' && cvd <= 40)) reasons.push('cvd-aligned');
    return this.result({ score: clamp(score), confidence: clamp(0.55 + Math.abs(confluence - 50) / 150), reasons });
  }
}


class NewsMacroAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'news-macro-agent' }); }
  evaluate(ctx) {
    const sentiment = String(ctx.macroSentiment || ctx.sentiment || '').toUpperCase();
    const blackout = !!ctx.newsBlackout;
    let score = 0.62; const reasons = []; let veto = false;
    if (blackout) { score = 0.05; veto = true; reasons.push('news-blackout'); }
    if (sentiment === 'BULLISH' && ctx.direction === 'LONG') { score += 0.18; reasons.push('macro-aligned'); }
    if (sentiment === 'BEARISH' && ctx.direction === 'SHORT') { score += 0.18; reasons.push('macro-aligned'); }
    if (sentiment === 'BEARISH' && ctx.direction === 'LONG') score -= 0.15;
    if (sentiment === 'BULLISH' && ctx.direction === 'SHORT') score -= 0.15;
    return this.result({ score: clamp(score), confidence: 0.65, veto, reasons });
  }
}

class LiquidityAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'liquidity-agent' }); }
  evaluate(ctx) {
    const spread = Number(ctx.spreadPct || 0); const depth = Number(ctx.orderBookDepthScore || 0.6);
    let score = 0.72 - Math.min(spread / 2, 0.35) + (depth - 0.5) * 0.25; const reasons=[]; let veto=false;
    if (spread > Number(ctx.maxSpreadPct || 0.15)) { veto=true; reasons.push('spread-limit'); }
    if (depth < 0.2) { score -= 0.25; reasons.push('thin-orderbook'); }
    if (spread < 0.05) reasons.push('tight-spread');
    return this.result({ score: clamp(score), confidence: 0.75, veto, reasons });
  }
}

class VolatilityAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'volatility-agent' }); }
  evaluate(ctx) {
    const atr = Number(ctx.atrPct || 0); let score = 0.68; const reasons=[];
    if (atr > 5) { score -= 0.28; reasons.push('extreme-volatility'); }
    else if (atr > 3) { score -= 0.10; reasons.push('elevated-volatility'); }
    else if (atr > 0 && atr < 0.5) { score -= 0.06; reasons.push('low-volatility'); }
    return this.result({ score: clamp(score), confidence: 0.72, reasons });
  }
}

class AnomalyAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'anomaly-agent' }); }
  evaluate(ctx) {
    const anomaly = Number(ctx.anomalyScore || 0); let score = 0.65; const reasons=[]; let veto=false;
    if (anomaly >= 0.9) { score=0.2; veto=true; reasons.push('critical-anomaly'); }
    else if (anomaly >= 0.7) { score -= 0.25; reasons.push('high-anomaly'); }
    else if (anomaly <= 0.2) reasons.push('normal-market');
    return this.result({ score: clamp(score), confidence: 0.68, veto, reasons });
  }
}

class PortfolioAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'portfolio-agent' }); }
  evaluate(ctx) {
    const correlation = Number(ctx.correlationRisk || 0); const exposure = Number(ctx.exposureRatio || 0);
    let score = 0.78; const reasons=[]; let veto=false;
    if (correlation > 0.85) { score -= 0.25; reasons.push('high-correlation'); }
    if (exposure > 0.9) { score -= 0.30; reasons.push('portfolio-exposure-high'); }
    if (exposure > 0.98) { veto=true; reasons.push('portfolio-cap'); }
    return this.result({ score: clamp(score), confidence: 0.8, veto, reasons });
  }
}

class ExecutionAgent extends BaseAgent {
  constructor(opts) { super({ ...opts, name: 'execution-agent' }); }
  evaluate(ctx) {
    const spread = Number(ctx.spreadPct || 0); const slippage = Number(ctx.expectedSlippagePct || 0);
    let score = 0.75 - spread * 0.5 - slippage * 0.8; const reasons=[]; let veto=false;
    if (slippage > 0.5) { score -= 0.25; reasons.push('high-slippage'); }
    if (spread > 0.4) { veto=true; reasons.push('execution-spread-too-wide'); }
    if (slippage <= 0.1) reasons.push('execution-quality-good');
    return this.result({ score: clamp(score), confidence: 0.74, veto, reasons });
  }
}

class AIAgentOrchestrator {
  constructor({ logger }) {
    this.logger = logger;
    this.agents = [
      new MarketRegimeAgent({ logger }), new SignalCriticAgent({ logger }),
      new RiskSentinelAgent({ logger }), new ConfluenceAgent({ logger }),
      new NewsMacroAgent({ logger }), new LiquidityAgent({ logger }),
      new VolatilityAgent({ logger }), new AnomalyAgent({ logger }),
      new PortfolioAgent({ logger }), new ExecutionAgent({ logger })
    ];
    this.enabled = new Map(this.agents.map(a => [a.name, true]));
    this.weights = new Map(Object.entries({
      'market-regime-agent':0.10,'signal-critic-agent':0.14,'risk-sentinel-agent':0.18,'confluence-agent':0.14,
      'news-macro-agent':0.08,'liquidity-agent':0.08,'volatility-agent':0.08,'anomaly-agent':0.06,
      'portfolio-agent':0.08,'execution-agent':0.06
    }));
  }

  evaluate(context) {
    const results = this.agents.filter(agent => this.enabled.get(agent.name) !== false).map(agent => {
      try { return agent.evaluate(context); }
      catch (error) {
        this.logger?.warn(`[AI-AGENT] ${agent.name} failed: ${error.message}`);
        return { agent: agent.name, score: 0.5, confidence: 0, veto: true, reasons: ['agent-error'] };
      }
    });
    const totalWeight = results.reduce((sum, item) => sum + (this.weights.get(item.agent) || 0), 0) || 1;
    const score = results.reduce((sum, item) => sum + item.score * (this.weights.get(item.agent) || 0), 0) / totalWeight;
    const confidence = results.reduce((sum, item) => sum + item.confidence, 0) / results.length;
    const veto = results.some(item => item.veto);
    return {
      score,
      confidence,
      veto,
      approved: !veto && score >= 0.58,
      results,
      reasons: results.flatMap(item => item.reasons || [])
    };
  }
  listAgents() {
    return this.agents.map(agent => ({ name: agent.name, enabled: this.enabled.get(agent.name) !== false, weight: this.weights.get(agent.name) || 0 }));
  }
  setAgent(name, enabled) {
    if (!this.enabled.has(name)) return false;
    this.enabled.set(name, !!enabled); return true;
  }
  setAll(enabled) { this.agents.forEach(a => this.enabled.set(a.name, !!enabled)); }
  getWeights() { return Object.fromEntries(this.weights); }
  setWeight(name, weight) { if (!this.weights.has(name)) return false; this.weights.set(name, Math.max(0, Number(weight)||0)); return true; }
}

module.exports = { AIAgentOrchestrator };
