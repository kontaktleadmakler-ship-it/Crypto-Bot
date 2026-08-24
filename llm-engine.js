'use strict';

const { GoogleGenAI } = require('@google/genai');

function safeJsonParse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

class GeminiLLMEngine {
  constructor({ apiKey, model = 'gemini-3.7-flash', logger, enabled = false, timeoutMs = 12000, cooldownMs = 60000 }) {
    this.enabled = !!enabled && !!apiKey;
    this.model = model;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.lastCallAt = 0;
    this.client = this.enabled ? new GoogleGenAI({ apiKey }) : null;
  }

  isAvailable() { return !!this.client && this.enabled; }
  status() { return { enabled: this.enabled, available: this.isAvailable(), model: this.model, cooldownMs: this.cooldownMs, lastCallAt: this.lastCallAt }; }
  enable(apiKey) { const key = apiKey || ''; if (!key) return false; this.client = new GoogleGenAI({ apiKey: key }); this.enabled = true; return true; }
  disable() { this.enabled = false; return true; }

  async analyzeSignal(context) {
    if (!this.isAvailable()) return { enabled: false, approved: true, confidence: 0, reason: 'llm-disabled' };
    if (Date.now() - this.lastCallAt < this.cooldownMs) {
      return { enabled: true, approved: true, confidence: 0, reason: 'llm-cooldown' };
    }
    this.lastCallAt = Date.now();
    const compact = {
      symbol: context.symbol,
      direction: context.direction,
      phase: context.marketPhase,
      score: context.signalScore,
      mlProbability: context.mlProbability,
      dqnAction: context.dqnAction,
      confluence: context.confluenceScore,
      ichimoku: context.ichimokuScore,
      volumeMACD: context.volumeMACDScore,
      cvd: context.cvdScore,
      trend1h: context.trend1h,
      trend4h: context.trend4h,
      adx: context.adx,
      rsi: context.rsi,
      atrPct: context.atrPct,
      spreadPct: context.spreadPct,
      fundingRate: context.fundingRate
    };
    const prompt = [
      'You are a crypto trading risk reviewer. Do not place orders.',
      'Review the candidate signal using only the supplied JSON.',
      'Return strict JSON with fields: approved (boolean), confidence (0..1), risk (LOW|MEDIUM|HIGH|CRITICAL), reasons (array of short strings).',
      'Reject weak or contradictory setups. Never invent missing data.',
      JSON.stringify(compact)
    ].join('\n');

    try {
      const interaction = await this.client.interactions.create({
        model: this.model,
        input: prompt,
        generation_config: { temperature: 0.1 }
      });
      const parsed = safeJsonParse(interaction.output_text || '');
      if (!parsed) return { enabled: true, approved: false, confidence: 0, risk: 'HIGH', reasons: ['llm-invalid-json'] };
      return {
        enabled: true,
        approved: parsed.approved === true,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        risk: ['LOW','MEDIUM','HIGH','CRITICAL'].includes(parsed.risk) ? parsed.risk : 'HIGH',
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 5) : []
      };
    } catch (error) {
      this.logger?.warn(`[LLM] Gemini request failed: ${error.message}`);
      return { enabled: true, approved: false, confidence: 0, risk: 'HIGH', reasons: ['llm-error'] };
    }
  }
}

module.exports = { GeminiLLMEngine };
