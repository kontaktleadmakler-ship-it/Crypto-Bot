
// P1-P4 execution hardening integration
import { ExecutionState, ExecutionStateMachine } from './execution-core/execution-state-machine.mjs';
import { AtomicIdempotency } from './execution-core/atomic-idempotency.mjs';
import { ExecutionEventStore } from './execution-core/execution-event-store.mjs';
import { FencingLease } from './execution-core/fencing-lease.mjs';
import { SymbolExecutionLock } from './symbol-execution-lock.mjs';
import { assertPreTradeSafe } from './pre-trade-gate.mjs';
import { RecoveryCoordinator } from './execution-core/recovery-coordinator.mjs';
import { protectedSubmit } from './execution-core/protected-submit.mjs';
import { CriticalStateQueue } from './execution-core/critical-state-queue.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JarvisEventBus } from './jarvis-event-bus.js';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ============================================================================
 * TRADING SIGNAL BOT - v25.0.9 INSTITUTIONAL EDITION
 * (Mit adaptivem TensorFlow.js ML, Deep Q-Network Agent, globaler Telegram-Queue,
 *  State-Persistenz, Hurst-Exponent, Marktphasen-Logging & Dynamic Filter Control)
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const winston = require('winston');
const { TensorFlowSignalModel } = require('./ml-engine');
const { DeepQTheTradingAgent } = require('./rl-engine'); // <-- DQN Agent Modul eingebunden
const HedgeManager = require('./hedgeManager');
const VolatilitySurfaceManager = require('./volatilitySurface');
const { OrderFlowAnalyzer } = require('./orderFlowAnalyzer');
const MacroFilterEngine = require('./macroFilter'); // <-- Makro & Sentiment Filter (in v21.1 wiederhergestellt)
const { runBacktest, buildConfig: buildBacktestConfig, optimizeHyperparameters } = require('./backtest-engine');
const {
  calculateEMA, calculateEMASeries, calculateRSI, calculateATR, calculateADX,
  calculateHurstExponent, calculateMACD, calculateVWAP, calculateVolumeProfilePOC,
  calculateRelativeVolume, checkSwingBreakOfStructure, calculateChoppinessIndex,
  findSwingStop, aggregate, trend
} = require('./src/indicators');
const { KuCoinFuturesAdapter } = require('./exchange-adapter');
const { ExecutionSimulator } = require('./execution-simulator');
const { ExecutionIdempotency } = require('./execution-idempotency');
const { PaperExecutionAdapter } = require('./paper-execution-adapter');
const { ReconciliationEngine } = require('./reconciliation-engine');
const { OrderBookEngine } = require('./orderbook-engine');
const { ExecutionParity } = require('./execution-parity');
const { RiskEngine } = require('./risk-engine');
const { splitWalkForward } = require('./walk-forward-validator');
const { evaluateProbabilities } = require('./ml-evaluation');
const { evaluateActions } = require('./dqn-evaluation');
const { InstitutionalAgentSuite } = require('./agent-suite');
const { AIAgentOrchestrator } = require('./ai-agents');
const { GeminiLLMEngine } = require('./llm-engine');
const { WalkForwardEngine } = require('./walk-forward-engine');
const { ModelDriftMonitor } = require('./model-drift-monitor');
const { AgentAttribution } = require('./agent-attribution');
const { SafetyController } = require('./institutional-core/safety-controller');
const { PortfolioLedger } = require('./institutional-core/portfolio-ledger');
const { ProductionReadinessGate } = require('./institutional-core/readiness-gate');
const { AuditTrail } = require('./audit-trail');
const { DynamicTimeStopAgent } = require('./dynamic-time-stop-agent');
const { TimesFMForecastAgent } = require('./timesfm-forecast-agent');
const { MonteCarloEngine } = require('./monte-carlo-engine');
const { analyze: analyzeRegimeIntelligence } = require('./jarvis-regime-intelligence');
const { route: adaptiveStrategyRoute } = require('./adaptive-strategy-router');
const { compare: counterfactualCompare } = require('./counterfactual-decision-engine');
const { MarketDataReplay } = require('./market-data-replay.js');
const { buildCoinTimeline } = require('./coin-timeline.js');
const { downloadOHLCV, writeDataset, GRANULARITY } = require('./scripts/download-ohlcv');
const fs = require('fs');

// ==========================================
// OHLCV RESEARCH DATA MANAGER (Telegram)
// Background-only: downloads public market data for offline backtests.
// It never places, modifies or cancels exchange orders.
// ==========================================
const OHLCV_DATA_ROOT = path.join(__dirname, 'data', 'ohlcv');
const ohlcvJobs = new Map();

function normalizeOhlcvSymbol(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}(?:[-_]?USDT)$/.test(raw)) return null;
  const base = raw.replace(/[-_]/g, '').replace(/USDT$/, '');
  if (!base) return null;
  return `${base}-USDT`;
}

function ohlcvJobKey(symbol, timeframe) { return `${symbol}:${timeframe}`; }

function startOhlcvDownload({ symbol, timeframe, from, to = Date.now(), chatId, mode = 'download' }) {
  const key = ohlcvJobKey(symbol, timeframe);
  const existing = ohlcvJobs.get(key);
  if (existing && ['queued', 'running'].includes(existing.status)) return { existing: true, job: existing };

  const job = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, key, symbol, timeframe, from, to, chatId: String(chatId), mode, status: 'queued', startedAt: Date.now(), updatedAt: Date.now(), percent: 0, candles: 0, requests: 0, error: null, file: null, cancelled: false };
  ohlcvJobs.set(key, job);

  (async () => {
    job.status = 'running'; job.updatedAt = Date.now();
    try {
      const dataset = await downloadOHLCV({
        symbol, timeframe, from, to,
        logger: { log: msg => logger.info(msg) },
        shouldContinue: () => !job.cancelled && !isShuttingDown,
        onProgress: progress => {
          job.percent = Number(progress.percent || 0);
          job.candles = progress.candles || 0;
          job.requests = progress.requests || 0;
          job.updatedAt = Date.now();
        }
      });
      if (job.cancelled) { job.status = 'cancelled'; return; }
      job.file = writeDataset(dataset, OHLCV_DATA_ROOT);
      job.percent = 100; job.candles = dataset.bars.length; job.requests = dataset.requests; job.quality = dataset.quality; job.status = 'completed'; job.updatedAt = Date.now();
      await sendTelegramReply(job.chatId, `✅ <b>OHLCV DOWNLOAD FERTIG</b>\n━━━━━━━━━━━━━━━━━━\n<b>${escapeHtml(symbol)} · ${escapeHtml(timeframe)}</b>\nKerzen: <b>${dataset.bars.length.toLocaleString('de-DE')}</b>\nRequests: ${dataset.requests}\nGaps: ${dataset.quality.missingBars}\nDuplicates: ${dataset.quality.duplicates}\nInvalid: ${dataset.quality.invalid}\n\n<code>${escapeHtml(path.relative(__dirname, job.file))}</code>`);
    } catch (e) {
      job.error = e.message; job.updatedAt = Date.now();
      job.status = e.code === 'OHLCV_DOWNLOAD_CANCELLED' ? 'cancelled' : 'failed';
      if (job.status === 'failed') await sendTelegramReply(job.chatId, `❌ <b>OHLCV DOWNLOAD FEHLGESCHLAGEN</b>\n${escapeHtml(symbol)} · ${escapeHtml(timeframe)}\n<code>${escapeHtml(e.message)}</code>`);
    }
  })().catch(e => logger.error(`[OHLCV] Background job fatal: ${e.message}`));
  return { existing: false, job };
}

function listOhlcvDatasets() {
  const result = [];
  if (!fs.existsSync(OHLCV_DATA_ROOT)) return result;
  for (const symbol of fs.readdirSync(OHLCV_DATA_ROOT, { withFileTypes: true })) {
    if (!symbol.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(OHLCV_DATA_ROOT, symbol.name))) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(OHLCV_DATA_ROOT, symbol.name, file);
      try {
        const meta = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        result.push({ symbol: meta.symbol || symbol.name, timeframe: meta.timeframe || file.slice(0, -5), from: meta.from, to: meta.to, bars: meta.bars?.length || 0, quality: meta.quality || {}, file: path.relative(__dirname, filePath) });
      } catch (e) { logger.warn(`[OHLCV] Dataset konnte nicht gelesen werden ${filePath}: ${e.message}`); }
    }
  }
  return result.sort((a, b) => `${a.symbol}:${a.timeframe}`.localeCompare(`${b.symbol}:${b.timeframe}`));
}

// ==========================================
// 1. LOGGER, LOG-SPEICHER & GLOBALE ZUSTÄNDE
// ==========================================
const { Writable } = require('stream');

const recentLogs = [];
const memoryStream = new Writable({
  write(chunk, encoding, callback) {
    recentLogs.push(chunk.toString().trim());
    if (recentLogs.length > 50) recentLogs.shift();
    callback();
  }
});

const memoryLogTransport = new winston.transports.Stream({
  stream: memoryStream
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    memoryLogTransport
  ]
});

let isShuttingDown = false;
let currentMarketPhase = 'RANGING';
let adaptiveConfig = null;
let lastScanStats = null;
let scanCounter = 0;

let currentStreak = 0;
let maxWinStreak = 0;
let maxLossStreak = 0;

let peakCapital = parseFloat(process.env.CAPITAL_USD) || 10000;
let dailyNetPnL = 0;
let consecutiveLosses = 0;

const MAX_DRAWDOWN_PERCENT = parseFloat(process.env.MAX_DRAWDOWN_PERCENT) || 25;
const DAILY_PROFIT_TARGET = parseFloat(process.env.DAILY_PROFIT_TARGET) || 500;

let kucoinErrorCount = 0;
let kucoinCircuitOpenUntil = 0;
const KUCOIN_CIRCUIT_THRESHOLD = 3;
const KUCOIN_CIRCUIT_COOLDOWN_MS = 300000;

const manualBlacklist = new Set();

// ==========================================
// 2. FILTER REGISTRY & ZENTRALE KONFIGURATION
// ==========================================
const FILTER_REGISTRY = {
  hurst: { configKey: 'MIN_HURST_EXPONENT', name: 'Hurst Exponent', default: 0.52, type: 'numeric', step: 0.02, direction: 'higher_is_harder', min: 0.0, max: 0.95 },
  adx:   { configKey: 'ADX_MIN',            name: 'ADX Minimum',    default: 20,   type: 'numeric', step: 2.0,  direction: 'higher_is_harder', min: 0,   max: 60 },
  bos:   { configKey: 'BOS_LOOKBACK',       name: 'BOS Lookback',   default: 10,   type: 'numeric', step: 2,    direction: 'higher_is_harder', min: 2,   max: 50 },
  relvol:{ configKey: 'MIN_RELATIVE_VOLUME',name: 'Rel. Volumen',   default: 1.2,  type: 'numeric', step: 0.1,  direction: 'higher_is_harder', min: 0.0, max: 10.0 },
  chop:  { configKey: 'MAX_CHOP_INDEX',     name: 'Max Chop Index', default: 61.8, type: 'numeric', step: 2.0,  direction: 'lower_is_harder',  min: 10,  max: 90 },
  rsi_long_min:  { configKey: 'RSI_LONG_MIN',  name: 'RSI Long Min',   default: 48,   type: 'numeric', step: 2.0,  direction: 'higher_is_harder', min: 10,  max: 80 },
  rsi_short_max: { configKey: 'RSI_SHORT_MAX', name: 'RSI Short Max',  default: 52,   type: 'numeric', step: 2.0,  direction: 'lower_is_harder',  min: 20,  max: 90 },
  trend4h:       { configKey: 'REQUIRE_4H_TREND', name: '4H Trend-Filter', default: true, type: 'boolean' },
  btctrend:      { configKey: 'ALLOW_COUNTER_BTC_TREND', name: 'Gegen-BTC-Trend', default: false, type: 'boolean' },
  timetrend:     { configKey: 'ENABLE_TIME_FILTER', name: 'Time-based Learning Filter', default: true, type: 'boolean' }
};

const filterState = {};
Object.keys(FILTER_REGISTRY).forEach(key => {
  filterState[key] = { enabled: true };
});

// ==========================================
// 3. API LATENZ & RATE LIMITER
// ==========================================
const apiLatencyStats = {
  kucoin: [],
  telegram: [],
  mongodb: [],
  
  record(service, latencyMs) {
    if (!this[service]) this[service] = [];
    this[service].push({ time: Date.now(), latency: latencyMs });
    if (this[service].length > 100) this[service].shift();
  },
  
  getAverage(service) {
    if (!this[service] || this[service].length === 0) return 0;
    return this[service].reduce((sum, e) => sum + e.latency, 0) / this[service].length;
  }
};

// BUGFIX: the previous implementation reset the whole 60s window and made
// every caller sleep up to a full windowMs whenever the limit was hit.
// Under concurrent load, many symbols would all discover the limit within
// the same tick, each start a ~60s sleep at roughly the same moment, and
// all wake up together - long past the per-item scan timeout, which made
// otherwise-fine requests look like they had hung and get killed by the
// asyncPool timeout instead of completing. This now uses a sliding window
// and only waits, in short bounded increments, exactly as long as needed
// for the oldest request to age out - so waits are proportional to actual
// load and callers are naturally desynchronized instead of piling into one
// shared sleep.
const apiRateLimiter = {
  timestamps: [],
  maxRequests: 1800,
  windowMs: 60000,

  async checkLimit() {
    for (;;) {
      const now = Date.now();
      while (this.timestamps.length > 0 && now - this.timestamps[0] > this.windowMs) {
        this.timestamps.shift();
      }
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const waitMs = Math.min(Math.max(this.windowMs - (now - this.timestamps[0]) + 25, 25), 5000);
      logger.warn(`⚠️ API Rate-Limit erreicht (${this.timestamps.length}/${this.maxRequests}), warte ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
};

// ==========================================
// 4. BULK QUEUE & LRU CACHE
// ==========================================
let dbBulkQueue = [];
let dbBulkTimer = null;

class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  
  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  delete(key) { this.cache.delete(key); }
  has(key) { return this.cache.has(key); }
  get size() { return this.cache.size; }
  
  cleanup(maxAge) {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > maxAge) this.cache.delete(key);
    }
  }
}

// ==========================================
// 5. HELFER & TELEGRAM ENGINE
// ==========================================
function safeParseFloat(value, fieldName, context) {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    logger.error(`[DATA ERROR] ${fieldName} bei ${context}: ${JSON.stringify(value)}`);
    return null;
  }
  return parsed;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function todayUTCString() { return new Date().toISOString().slice(0, 10); }

const configTelegram = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || ''
};

let telegramQueue = Promise.resolve();

function queueTelegramMessage(taskFn) {
  telegramQueue = telegramQueue.then(async () => {
    try {
      await taskFn();
    } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); }
  });
  return telegramQueue;
}

async function sendTelegramAlert(text) {
  if (!configTelegram.botToken || !configTelegram.chatId) return;
  const startTime = Date.now();
  const chatIds = configTelegram.chatId.split(',').map(id => id.trim()).filter(Boolean);

  for (const chatId of chatIds) {
    await queueTelegramMessage(async () => {
      let success = false;
      let attempts = 0;
      let delay = 3000;

      while (!success && attempts < 3) {
        try {
          attempts++;
          await axios.post(
            `https://api.telegram.org/bot${configTelegram.botToken}/sendMessage`,
            { chat_id: chatId, text: text, parse_mode: 'HTML' },
            { timeout: 10000 }
          );
          success = true;
          await sleep(500);
        } catch (e) {
          if (e.response && e.response.status === 429) {
            logger.warn(`⚠️ Telegram Rate-Limit (429) für Chat ${chatId}. Warte ${delay}ms...`);
            await sleep(delay);
            delay *= 2;
          } else {
            logger.error(`Telegram (${chatId}): ${e.message}`);
            break;
          }
        }
      }
    });
  }
  apiLatencyStats.record('telegram', Date.now() - startTime);
}

async function sendTelegramReply(chatId, text) {
  if (!configTelegram.botToken || !chatId) return;
  await queueTelegramMessage(async () => {
    let success = false;
    let attempts = 0;
    let delay = 3000;

    while (!success && attempts < 3) {
      try {
        attempts++;
        await axios.post(
          `https://api.telegram.org/bot${configTelegram.botToken}/sendMessage`,
          { chat_id: chatId, text: text, parse_mode: 'HTML' },
          { timeout: 10000 }
        );
        success = true;
        await sleep(500);
      } catch (e) {
        if (e.response && e.response.status === 429) {
          logger.warn(`⚠️ Telegram Reply Rate-Limit (429) für Chat ${chatId}. Warte ${delay}ms...`);
          await sleep(delay);
          delay *= 2;
        } else {
          logger.error(`Telegram Reply (${chatId}): ${e.message}`);
          break;
        }
      }
    }
  });
}

async function getAlertTimestamp(key) {
  if (!botStateCollection || !isDbConnected) return 0;
  try {
    const doc = await botStateCollection.findOne({ _id: `alert_${key}` });
    return doc ? doc.lastSent : 0;
  } catch (e) {
    return 0;
  }
}

async function persistAlertHistoryEntry(key, timestamp) {
  if (!botStateCollection || !isDbConnected) return;
  try {
    await botStateCollection.updateOne(
      { _id: `alert_${key}` },
      { $set: { lastSent: timestamp } },
      { upsert: true }
    );
  } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); }
}

async function sendDeduplicatedAlert(key, text, cooldownMs = 300000) {
  const lastSent = await getAlertTimestamp(key);
  if (Date.now() - lastSent < cooldownMs) return;
  await persistAlertHistoryEntry(key, Date.now());
  await sendTelegramAlert(text);
}

async function sendBatchedSignalAlert(signals) {
  if (signals.length === 0) return;
  if (signals.length === 1) {
    await sendTelegramAlert(signals[0].text);
    return;
  }
  let batchText = `🚀 <b>${signals.length} NEUE SIGNALE</b>\n━━━━━━━━━━━━━━━━━━\n\n`;
  signals.forEach((signal, index) => {
    batchText += `${index + 1}. ${signal.text}\n\n`;
  });
  batchText += `⚠️ <b>Mehrere Signale - Position Sizing beachten!</b>`;
  await sendTelegramAlert(batchText);
}

function updateTelegramConfig(token, chatId) {
  configTelegram.botToken = token;
  configTelegram.chatId = chatId;
}

// Register the full v24.6 command menu in Telegram. The command handlers above
// are available regardless of whether Telegram shows them in the UI; calling
// setMyCommands makes the commands appear in Telegram's slash-command menu.
const TELEGRAM_COMMANDS_V24_6 = [
  { command: 'start', description: 'Bot-Hilfe und Status' },
  { command: 'help', description: 'Vollständige Hilfe' },
  { command: 'commands', description: 'AI-Agent Command Center' },
  { command: 'aicommands', description: 'AI-Agent Commands' },
  { command: 'agents', description: 'AI-Agent Status' },
  { command: 'agents_status', description: 'AI-Agent Status' },
  { command: 'agent', description: 'Agent-Details anzeigen' },
  { command: 'agent_on', description: 'Agent aktivieren' },
  { command: 'agent_off', description: 'Agent deaktivieren' },
  { command: 'agents_on', description: 'Alle Agents aktivieren' },
  { command: 'agents_off', description: 'Alle Agents deaktivieren' },
  { command: 'agent_weights', description: 'Agent-Gewichtungen anzeigen' },
  { command: 'llm', description: 'LLM Status' },
  { command: 'llm_status', description: 'LLM Status anzeigen' },
  { command: 'llm_on', description: 'LLM Reviewer aktivieren' },
  { command: 'llm_off', description: 'LLM Reviewer deaktivieren' },
  { command: 'llm_test', description: 'LLM Test ausführen' },
  { command: 'signals', description: 'AI Signal Snapshot' },
  { command: 'top_signals', description: 'Top Signale' },
  { command: 'signal', description: 'Symbol analysieren' },
  { command: 'explain', description: 'Signal erklären' },
  { command: 'confluence', description: 'Confluence anzeigen' },
  { command: 'anomalies', description: 'Anomalien anzeigen' },
  { command: 'regime', description: 'Marktregime anzeigen' },
  { command: 'risk', description: 'Risk Snapshot' },
  { command: 'ai_hardening', description: 'AI Hardening Status' },
  { command: 'ai_architecture', description: 'AI Architektur Status' },
  { command: 'drift', description: 'Model Drift Status' },
  { command: 'model_drift', description: 'Model Drift Status' },
  { command: 'agent_attribution', description: 'Agent Attribution' },
  { command: 'agent_stats', description: 'Agent Statistiken' },
  { command: 'kill_status', description: 'Safety/Kill Status' },
  { command: 'retrain', description: 'ML/DQN Training starten' },
  { command: 'scan', description: 'Manuellen Market Scan starten' },
  { command: 'scanstats', description: 'Scan Statistik' },
  { command: 'status', description: 'Bot Status' },
  { command: 'stats', description: 'Tagesperformance' },
  { command: 'pause', description: 'Bot pausieren' },
  { command: 'resume', description: 'Bot fortsetzen' },
  { command: 'download', description: 'Historische OHLCV-Daten laden' },
  { command: 'download_status', description: 'OHLCV Download-Status' },
  { command: 'download_cancel', description: 'OHLCV Download abbrechen' },
  { command: 'datasets', description: 'Lokale OHLCV-Datasets anzeigen' },
  { command: 'update', description: 'OHLCV-Dataset inkrementell aktualisieren' }
];

async function registerTelegramCommands() {
  const token = configTelegram.botToken || config.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const endpoint = `https://api.telegram.org/bot${token}/setMyCommands`;
  try {
    // Global command list.
    await axios.post(endpoint, { commands: TELEGRAM_COMMANDS_V24_6 }, { timeout: 10000 });

    // Telegram supports a per-chat scope. Register it for every configured
    // authorized chat so the command menu is guaranteed to appear there.
    const chatIds = String(configTelegram.chatId || '')
      .split(',').map(id => id.trim()).filter(Boolean);
    for (const chatId of chatIds) {
      if (!/^-?\d+$/.test(chatId)) continue;
      try {
        await axios.post(endpoint, {
          commands: TELEGRAM_COMMANDS_V24_6,
          scope: { type: 'chat', chat_id: Number(chatId) }
        }, { timeout: 10000 });
      } catch (chatErr) {
        logger.warn(`⚠️ Telegram Command-Menü für Chat ${chatId} konnte nicht registriert werden: ${chatErr.message}`);
      }
    }
    logger.info(`🤖 Telegram AI-Agent Command-Menü registriert (${TELEGRAM_COMMANDS_V24_6.length} Commands).`);
    return true;
  } catch (e) {
    logger.error(`❌ Telegram Command-Menü Registrierung fehlgeschlagen: ${e.message}`);
    return false;
  }
}

// ==========================================
// 6. KORRELATIONS-GRUPPEN
// ==========================================
const CORRELATION_GROUPS = {
  'MAJOR':   ['BTC-USDT', 'ETH-USDT'],
  'DEFI':    ['UNI-USDT', 'AAVE-USDT', 'MKR-USDT', 'COMP-USDT', 'CRV-USDT', 'SNX-USDT'],
  'L1':      ['SOL-USDT', 'AVAX-USDT', 'NEAR-USDT', 'APT-USDT', 'SUI-USDT', 'SEI-USDT'],
  'L2':      ['ARB-USDT', 'OP-USDT', 'MATIC-USDT', 'IMX-USDT', 'STRK-USDT'],
  'MEME':    ['DOGE-USDT', 'SHIB-USDT', 'PEPE-USDT', 'WIF-USDT', 'BONK-USDT'],
  'AI':      ['FET-USDT', 'AGIX-USDT', 'OCEAN-USDT', 'WLD-USDT', 'RNDR-USDT'],
  'GAMING':  ['GALA-USDT', 'SAND-USDT', 'MANA-USDT', 'AXS-USDT'],
};

function checkCorrelationLimit(symbol, direction, activeTrades, enabled = true) {
  if (!enabled) return true;
  for (const [group, coins] of Object.entries(CORRELATION_GROUPS)) {
    if (coins.includes(symbol)) {
      const sameInGroup = [...activeTrades.values()].filter(t => coins.includes(t.symbol) && t.direction === direction).length;
      return sameInGroup === 0;
    }
  }
  return true;
}

// ==========================================
// 7. STRATEGIE PROFILES & CONFIG
// ==========================================
const STRATEGY_PROFILES = {
  loose: {
    ALLOW_COUNTER_BTC_TREND: true,
    REQUIRE_4H_TREND: false,
    ADX_MIN: 15,
    RSI_LONG_MIN: 40,
    RSI_LONG_MAX: 75,
    RSI_SHORT_MIN: 25,
    RSI_SHORT_MAX: 60,
    MIN_RELATIVE_VOLUME: 0.8,
    BOS_LOOKBACK: 4,
    TREND_EMA_FAST_15M: 20,        
    TREND_EMA_SLOW_15M: 50,
  },
  strict: {
    ALLOW_COUNTER_BTC_TREND: false,
    REQUIRE_4H_TREND: true,
    ADX_MIN: 20,
    RSI_LONG_MIN: 48,
    RSI_LONG_MAX: 68,
    RSI_SHORT_MIN: 32,
    RSI_SHORT_MAX: 52,
    MIN_RELATIVE_VOLUME: 1.2,
    BOS_LOOKBACK: 10,
    TREND_EMA_FAST_15M: 20,
    TREND_EMA_SLOW_15M: 50,
  }
};

let STRATEGY_PROFILE_NAME = (process.env.STRATEGY_PROFILE || 'strict').toLowerCase();
let activeProfile = STRATEGY_PROFILES[STRATEGY_PROFILE_NAME] || STRATEGY_PROFILES.strict;

function envFloatOrProfile(envVal, profileVal) { return envVal !== undefined ? parseFloat(envVal) : profileVal; }
function envBoolOrProfile(envVal, profileVal, trueLiteral) {
  if (envVal === undefined) return profileVal;
  return trueLiteral ? envVal === 'true' : envVal !== 'false';
}

const config = {
  PORT: parseInt(process.env.PORT, 10) || 10000,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  MONGODB_URI: process.env.MONGODB_URI || '',
  
  CAPITAL_USD: parseFloat(process.env.CAPITAL_USD) || 10000,
  RISK_PERCENT: parseFloat(process.env.RISK_PERCENT) || 0.75,
  TOP_COIN_LIMIT: parseInt(process.env.TOP_COIN_LIMIT, 10) || 150,
  MAX_SIGNALS_PER_SCAN: parseInt(process.env.MAX_SIGNALS_PER_SCAN, 10) || 5,
  MAX_CONCURRENT_TRADES: parseInt(process.env.MAX_CONCURRENT_TRADES, 10) || 3,
  MAX_DAILY_LOSS_USD: parseFloat(process.env.MAX_DAILY_LOSS_USD) || 250,
  MAX_FUNDING_RATE: parseFloat(process.env.MAX_FUNDING_RATE) || 0.0005,
  MIN_FUNDING_RATE: parseFloat(process.env.MIN_FUNDING_RATE) || -0.0005,

  ALLOW_COUNTER_BTC_TREND: envBoolOrProfile(process.env.ALLOW_COUNTER_BTC_TREND, activeProfile.ALLOW_COUNTER_BTC_TREND, false),
  REQUIRE_4H_TREND: envBoolOrProfile(process.env.REQUIRE_4H_TREND, activeProfile.REQUIRE_4H_TREND, true),
  ADX_MIN: envFloatOrProfile(process.env.ADX_MIN, activeProfile.ADX_MIN),
  RSI_LONG_MIN: envFloatOrProfile(process.env.RSI_LONG_MIN, activeProfile.RSI_LONG_MIN),
  RSI_LONG_MAX: envFloatOrProfile(process.env.RSI_LONG_MAX, activeProfile.RSI_LONG_MAX),
  RSI_SHORT_MIN: envFloatOrProfile(process.env.RSI_SHORT_MIN, activeProfile.RSI_SHORT_MIN),
  RSI_SHORT_MAX: envFloatOrProfile(process.env.RSI_SHORT_MAX, activeProfile.RSI_SHORT_MAX),
  MIN_RELATIVE_VOLUME: envFloatOrProfile(process.env.MIN_RELATIVE_VOLUME, activeProfile.MIN_RELATIVE_VOLUME),
  BOS_LOOKBACK: process.env.BOS_LOOKBACK !== undefined ? parseInt(process.env.BOS_LOOKBACK, 10) : activeProfile.BOS_LOOKBACK,
  TREND_EMA_FAST_15M: process.env.TREND_EMA_FAST_15M !== undefined ? parseInt(process.env.TREND_EMA_FAST_15M, 10) : activeProfile.TREND_EMA_FAST_15M,
  TREND_EMA_SLOW_15M: process.env.TREND_EMA_SLOW_15M !== undefined ? parseInt(process.env.TREND_EMA_SLOW_15M, 10) : activeProfile.TREND_EMA_SLOW_15M,

  ATR_STOP_MULT: parseFloat(process.env.ATR_STOP_MULT) || 2.3,
  TP1_MULT: parseFloat(process.env.TP1_MULT) || 1.3,
  TP2_MULT: parseFloat(process.env.TP2_MULT) || 2.5,
  MAX_HOLD_HOURS: parseFloat(process.env.MAX_HOLD_HOURS) || 4,
  ABSOLUTE_MAX_HOLD_HOURS: parseFloat(process.env.ABSOLUTE_MAX_HOLD_HOURS) || 24,
  MAX_SAME_DIRECTION: parseInt(process.env.MAX_SAME_DIRECTION, 10) || 2,
  TRAILING_STOP_ENABLED: process.env.TRAILING_STOP_ENABLED !== 'false',
  TRAILING_ATR_MULT: parseFloat(process.env.TRAILING_ATR_MULT) || 2.2,
  DYNAMIC_TRAILING_ATR: process.env.DYNAMIC_TRAILING_ATR !== 'false',
  FAST_TRACK_INTERVAL_SECONDS: parseInt(process.env.FAST_TRACK_INTERVAL_SECONDS, 10) || 60,
  TICKER_BATCH_SIZE: parseInt(process.env.TICKER_BATCH_SIZE, 10) || 10,
  SLIPPAGE_PERCENT: parseFloat(process.env.SLIPPAGE_PERCENT) || 0.05,
  FEE_PERCENT: parseFloat(process.env.FEE_PERCENT) || 0.1,

  // Phase B1-B4: paper execution only. Live execution remains impossible.
  PAPER_EXECUTION_ENABLED: process.env.PAPER_EXECUTION_ENABLED !== 'false',
  PAPER_EXECUTION_LATENCY_MS: parseFloat(process.env.PAPER_EXECUTION_LATENCY_MS) || 150,
  PAPER_SPREAD_PERCENT: parseFloat(process.env.PAPER_SPREAD_PERCENT) || 0,
  PAPER_SLIPPAGE_PERCENT: parseFloat(process.env.PAPER_SLIPPAGE_PERCENT) || (parseFloat(process.env.SLIPPAGE_PERCENT) || 0.05),
  PAPER_IMPACT_BPS: parseFloat(process.env.PAPER_IMPACT_BPS) || 5,
  PAPER_MAKER_FEE_PERCENT: parseFloat(process.env.PAPER_MAKER_FEE_PERCENT) || 0.08,
  PAPER_TAKER_FEE_PERCENT: parseFloat(process.env.PAPER_TAKER_FEE_PERCENT) || (parseFloat(process.env.FEE_PERCENT) || 0.1),
  PAPER_FILL_RATIO: parseFloat(process.env.PAPER_FILL_RATIO) || 1,
  TP1_CLOSE_PERCENT: parseFloat(process.env.TP1_CLOSE_PERCENT) || 60,
  ENABLE_SHORT_SIGNALS: process.env.ENABLE_SHORT_SIGNALS !== 'false',
  MAX_EXPOSURE_RATIO: parseFloat(process.env.MAX_EXPOSURE_RATIO) || 0.6,
  // KuCoin-safe defaults: market-data fan-out is intentionally bounded.
  // 3 concurrent scan workers keeps each worker's multi-request bundle from
  // creating a burst of 15m/1h/4h/orderbook/futures calls. Operators can
  // override this explicitly through Render environment variables.
  SCAN_CONCURRENCY: parseInt(process.env.SCAN_CONCURRENCY, 10) || 3,
  SCAN_ITEM_TIMEOUT_MS: parseInt(process.env.SCAN_ITEM_TIMEOUT_MS, 10) || 75000,
  MARKET_DATA_CONCURRENCY: parseInt(process.env.MARKET_DATA_CONCURRENCY, 10) || 3,
  SCAN_WATCHDOG_MS: parseInt(process.env.SCAN_WATCHDOG_MS, 10) || 300000,
  MAX_CONSECUTIVE_PRICE_FAILURES: parseInt(process.env.MAX_CONSECUTIVE_PRICE_FAILURES, 10) || 10,
  LEVERAGE: parseInt(process.env.LEVERAGE, 10) || 3,
  MARGIN_MODE: (process.env.MARGIN_MODE || 'ISOLATED').toUpperCase(),
  AI_AGENTS_ENABLED: process.env.AI_AGENTS_ENABLED !== 'false',
  AI_AGENT_MIN_SCORE: parseFloat(process.env.AI_AGENT_MIN_SCORE) || 0.58,
  AI_LLM_ENABLED: process.env.AI_LLM_ENABLED === 'true',
  AI_LLM_COOLDOWN_MS: parseInt(process.env.AI_LLM_COOLDOWN_MS, 10) || 60000,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.7-flash',

  LOCK_ACQUIRE_RETRIES: parseInt(process.env.LOCK_ACQUIRE_RETRIES, 10) || 30,
  LOCK_ACQUIRE_RETRY_DELAY_MS: parseInt(process.env.LOCK_ACQUIRE_RETRY_DELAY_MS, 10) || 5000,
  // A heartbeat every few seconds means a lock that has stopped updating for
  // even 30-45s is already overwhelming evidence the owning process is dead
  // (crashed, OOM-killed, or force-replaced) — no signal handler can run in
  // those cases, so staleness detection (not graceful release) is the only
  // backstop. A multi-minute default here just turns every hard-kill into
  // several minutes of avoidable downtime on every redeploy.
  LOCK_STALE_AFTER_MS: parseInt(process.env.LOCK_STALE_AFTER_MS, 10) || 30 * 1000,
  LOCK_HEARTBEAT_INTERVAL_MS: parseInt(process.env.LOCK_HEARTBEAT_INTERVAL_MS, 10) || 5000,

  FUNDING_INTERVAL_HOURS: parseFloat(process.env.FUNDING_INTERVAL_HOURS) || 8,
  SCAN_STATS_TELEGRAM_EVERY_N_SCANS: parseInt(process.env.SCAN_STATS_TELEGRAM_EVERY_N_SCANS, 10) || 4,
  
  MAX_KLINES_CACHE_SIZE: parseInt(process.env.MAX_KLINES_CACHE_SIZE, 10) || 200,
  CACHE_CLEANUP_MINUTES: parseInt(process.env.CACHE_CLEANUP_MINUTES, 10) || 5,
  
  RISK_WARNING_ENABLED: process.env.RISK_WARNING_ENABLED !== 'false',
  MAX_WEEKLY_DRAWDOWN_PERCENT: parseFloat(process.env.MAX_WEEKLY_DRAWDOWN_PERCENT) || 10,
  MAX_CONSECUTIVE_LOSSES: parseInt(process.env.MAX_CONSECUTIVE_LOSSES, 10) || 3,
  
  ENABLE_ADAPTIVE_PARAMS: process.env.ENABLE_ADAPTIVE_PARAMS !== 'false',
  ENABLE_KELLY_SIZING: process.env.ENABLE_KELLY_SIZING !== 'false',
  ENABLE_ORDERBOOK_ANALYSIS: process.env.ENABLE_ORDERBOOK_ANALYSIS !== 'false',
  ENABLE_CORRELATION_LIMITS: process.env.ENABLE_CORRELATION_LIMITS !== 'false',
  ENABLE_MULTI_TF_DERIVATION: process.env.ENABLE_MULTI_TF_DERIVATION !== 'false',
  ENABLE_PRELOADING: process.env.ENABLE_PRELOADING !== 'false',
  ENABLE_BATCH_SIGNALS: process.env.ENABLE_BATCH_SIGNALS !== 'false',
  ENABLE_TIME_FILTER: process.env.ENABLE_TIME_FILTER !== 'false',
  ORDERBOOK_DEPTH_LEVELS: parseInt(process.env.ORDERBOOK_DEPTH_LEVELS, 10) || 10,
  
  MAX_DRAWDOWN_PERCENT: parseFloat(process.env.MAX_DRAWDOWN_PERCENT) || 25,
  DAILY_PROFIT_TARGET: parseFloat(process.env.DAILY_PROFIT_TARGET) || 500,
  MONGODB_POOL_SIZE: parseInt(process.env.MONGODB_POOL_SIZE, 10) || 10,
  DB_BULK_INTERVAL_MS: parseInt(process.env.DB_BULK_INTERVAL_MS, 10) || 5000,
  
  MAX_SPREAD_PERCENT: parseFloat(process.env.MAX_SPREAD_PERCENT) || 0.15,
  MAX_CHOP_INDEX: parseFloat(process.env.MAX_CHOP_INDEX) || 61.8,
  MIN_HURST_EXPONENT: parseFloat(process.env.MIN_HURST_EXPONENT) || 0.52,
  // Punkt 10: nach Konsolidierung von ADX/Hurst/Chop zu einem einzigen
  // Trend-Quality-Block (60 statt vorher 3x separat gewichteter Punkte)
  // verschiebt sich die Punkteverteilung leicht; Standard-Schwelle von
  // 65 auf 55 abgesenkt, um dieselbe relative Strenge beizubehalten.
  MIN_GATE_SCORE: parseFloat(process.env.MIN_GATE_SCORE) || 55,
  MIN_RRR: parseFloat(process.env.MIN_RRR) || 1.2,

  ML_ENABLED: process.env.ML_ENABLED !== 'false',
  ML_MIN_TRAINING_SAMPLES: parseInt(process.env.ML_MIN_TRAINING_SAMPLES, 10) || 40,
  ML_MAX_TRAINING_SAMPLES: parseInt(process.env.ML_MAX_TRAINING_SAMPLES, 10) || 2000,
  ML_MIN_PREDICTION_PROBABILITY: parseFloat(process.env.ML_MIN_PREDICTION_PROBABILITY) || 0.55,
  ML_STRONG_SIGNAL_PROBABILITY: parseFloat(process.env.ML_STRONG_SIGNAL_PROBABILITY) || 0.70,
  ML_RETRAIN_HOURS: parseFloat(process.env.ML_RETRAIN_HOURS) || 6,
  ML_EPOCHS: parseInt(process.env.ML_EPOCHS, 10) || 80,
  ML_BATCH_SIZE: parseInt(process.env.ML_BATCH_SIZE, 10) || 32,
  
  // DQN spezifische Config
  DQN_ENABLED: process.env.DQN_ENABLED !== 'false',
  BACKTEST_TRAIN_DAYS: parseInt(process.env.BACKTEST_TRAIN_DAYS, 10) || 30,
  BACKTEST_TEST_DAYS: parseInt(process.env.BACKTEST_TEST_DAYS, 10) || 7,
  BACKTEST_PURGE_DAYS: parseInt(process.env.BACKTEST_PURGE_DAYS, 10) || 1,
  BACKTEST_EMBARGO_DAYS: parseInt(process.env.BACKTEST_EMBARGO_DAYS, 10) || 1,
  MAX_PORTFOLIO_EXPOSURE_USD: parseFloat(process.env.MAX_PORTFOLIO_EXPOSURE_USD) || 0,
  API_KEY: process.env.API_KEY || '',
  HEALTH_PUBLIC: process.env.HEALTH_PUBLIC === 'true',
  ALLOW_UNAUTHENTICATED_API: process.env.ALLOW_UNAUTHENTICATED_API === 'true',
  BACKTEST_API_ENABLED: process.env.BACKTEST_API_ENABLED === 'true',
};

function validateConfig() {
  const numericFields = [
    'PORT', 'CAPITAL_USD', 'RISK_PERCENT', 'TOP_COIN_LIMIT', 'MAX_SIGNALS_PER_SCAN',
    'MAX_CONCURRENT_TRADES', 'MAX_DAILY_LOSS_USD', 'MAX_FUNDING_RATE', 'MIN_FUNDING_RATE',
    'ADX_MIN', 'BOS_LOOKBACK', 'RSI_LONG_MIN', 'RSI_LONG_MAX', 'RSI_SHORT_MIN',
    'RSI_SHORT_MAX', 'ATR_STOP_MULT', 'TP1_MULT', 'TP2_MULT', 'MAX_HOLD_HOURS',
    'ABSOLUTE_MAX_HOLD_HOURS', 'MIN_RELATIVE_VOLUME', 'MAX_SAME_DIRECTION',
    'TRAILING_ATR_MULT', 'FAST_TRACK_INTERVAL_SECONDS', 'TICKER_BATCH_SIZE',
    'SLIPPAGE_PERCENT', 'FEE_PERCENT',
    'PAPER_EXECUTION_LATENCY_MS', 'PAPER_SPREAD_PERCENT', 'PAPER_SLIPPAGE_PERCENT',
    'PAPER_IMPACT_BPS', 'PAPER_MAKER_FEE_PERCENT', 'PAPER_TAKER_FEE_PERCENT', 'PAPER_FILL_RATIO',
    'TP1_CLOSE_PERCENT', 'MAX_EXPOSURE_RATIO',
    'SCAN_CONCURRENCY', 'MARKET_DATA_CONCURRENCY', 'MAX_CONSECUTIVE_PRICE_FAILURES', 'LEVERAGE',
    'LOCK_ACQUIRE_RETRIES', 'LOCK_ACQUIRE_RETRY_DELAY_MS', 'LOCK_STALE_AFTER_MS',
    'FUNDING_INTERVAL_HOURS', 'SCAN_STATS_TELEGRAM_EVERY_N_SCANS',
    'TREND_EMA_FAST_15M', 'TREND_EMA_SLOW_15M',
    'MAX_KLINES_CACHE_SIZE', 'CACHE_CLEANUP_MINUTES',
    'MAX_WEEKLY_DRAWDOWN_PERCENT', 'MAX_CONSECUTIVE_LOSSES',
    'ORDERBOOK_DEPTH_LEVELS', 'MAX_DRAWDOWN_PERCENT', 'DAILY_PROFIT_TARGET',
    'MONGODB_POOL_SIZE', 'DB_BULK_INTERVAL_MS', 'MAX_SPREAD_PERCENT', 'MAX_CHOP_INDEX',
    'MIN_HURST_EXPONENT', 'ML_MIN_TRAINING_SAMPLES', 'ML_MAX_TRAINING_SAMPLES',
    'ML_MIN_PREDICTION_PROBABILITY', 'ML_STRONG_SIGNAL_PROBABILITY', 'ML_RETRAIN_HOURS',
    'ML_EPOCHS', 'ML_BATCH_SIZE', 'BACKTEST_TRAIN_DAYS', 'BACKTEST_TEST_DAYS', 'BACKTEST_PURGE_DAYS', 'BACKTEST_EMBARGO_DAYS', 'MAX_PORTFOLIO_EXPOSURE_USD'
  ];
  for (const key of numericFields) {
    if (typeof config[key] !== 'number' || Number.isNaN(config[key])) {
      throw new Error(`[CONFIG ERROR] ${key} ungültig. Bitte .env prüfen.`);
    }
  }
  if (!['ISOLATED', 'CROSS'].includes(config.MARGIN_MODE)) throw new Error(`[CONFIG ERROR] MARGIN_MODE ungültig`);
  logger.info('✅ Konfiguration validiert');
}
validateConfig();

function validateCriticalEnv() {
  const missing = [];
  if (!config.MONGODB_URI) missing.push('MONGODB_URI');
  if (!config.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
  if (!config.API_KEY && !config.ALLOW_UNAUTHENTICATED_API) missing.push('API_KEY');
  if (missing.length > 0) throw new Error(`[STARTUP ERROR] Fehlende Variablen: ${missing.join(', ')}`);
}
validateCriticalEnv();

updateTelegramConfig(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);

// ==========================================
// 8. DATENBANK & ADAPTIVES ML-MODELL & MANAGERS
// ==========================================
const client = new MongoClient(config.MONGODB_URI, {
  maxPoolSize: config.MONGODB_POOL_SIZE,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
  family: 4
});

// Bug fixed: previously isDbConnected only ever flipped to false inside
// initDatabase()'s own catch block, i.e. on the very first connection
// attempt. A connection that dropped later at runtime (network blip,
// Atlas maintenance, etc.) was never detected - isDbConnected stayed
// (wrongly) true and every DB write would keep silently failing/queuing.
// These listeners catch that case and kick off the reconnect loop below.
client.on('close', () => {
  if (isShuttingDown) return;
  if (isDbConnected) logger.warn('🔴 MongoDB-Verbindung unerwartet geschlossen.');
  isDbConnected = false;
  scheduleDbReconnect();
});
client.on('error', (err) => {
  logger.error(`🔴 MongoDB-Client-Fehler: ${err.message}`);
});

let db = null;
let tradesCollection, closedTradesCollection, botStateCollection, lockCollection, marketPhaseLogsCollection, filterChangeLogCollection;
let paperOrdersCollection, executionIdempotencyCollection;
const activeTrades = new Map();
// ===== Integrated Execution Core (P1-P4) =====
const symbolExecutionLock = new SymbolExecutionLock();
let executionIdempotency = null;
let executionEventStore = null;
let fencingLease = null;
let currentFencingToken = 0;
let executionCoreReady = false;
let orderBookEngine = new OrderBookEngine({
  logger,
  maxAgeMs: Number(process.env.ORDERBOOK_MAX_AGE_MS || process.env.MAX_MARKET_DATA_AGE_MS || 1500),
  depth: Number(process.env.ORDERBOOK_DEPTH_LEVELS || 10),
  onTradingPause: ({ symbol, reason }) => {
    logger.error?.(`[MARKET-DATA] TRADING PAUSE ${symbol}: ${reason}`);
  }
});

function makeExecutionId(symbol, side, clientOrderId = '') {
  return clientOrderId || `${symbol}:${side}:${Date.now()}:${crypto.randomUUID()}`;
}

async function initializeExecutionCore() {
  if (!db || !isDbConnected) {
    executionCoreReady = false;
    return false;
  }

  const executionCollection = db.collection('executionIntents');
  const executionEvents = db.collection('executionEvents');
  const executionOutbox = db.collection('executionOutbox');
  const leaseCollection = db.collection('instanceLeases');

  executionIdempotency = new AtomicIdempotency({
    collection: executionCollection,
    logger
  });

  executionEventStore = new ExecutionEventStore({
    eventsCollection: executionEvents,
    outboxCollection: executionOutbox,
    logger
  });

  fencingLease = new FencingLease({
    collection: leaseCollection,
    instanceId: currentInstanceId,
    leaseMs: 15000
  });

  const lease = await fencingLease.acquire();
  if (!lease.acquired) {
    executionCoreReady = false;
    logger.error?.('[EXECUTION] fencing lease not acquired');
    return false;
  }

  currentFencingToken = lease.fencingToken;
  executionCoreReady = true;
  return true;
}

async function renewExecutionLease() {
  if (!fencingLease) return false;
  const result = await fencingLease.renew();
  if (!result.renewed) {
    executionCoreReady = false;
    isPaused = true;
    logger.error?.('[EXECUTION] fencing lease lost; trading paused');
    return false;
  }
  currentFencingToken = result.fencingToken;
  return true;
}

function buildPreTradeContext({ orderBookValid = false, spreadPct = Infinity, marketDataAgeMs = Infinity, risk = { allowed: false, reason: 'UNKNOWN' } } = {}) {
  return {
    dbHealthy: isDbConnected === true,
    instanceLeaseValid: executionCoreReady === true && currentFencingToken > 0,
    marketDataHealthy: Number.isFinite(marketDataAgeMs),
    marketDataAgeMs,
    maxMarketDataAgeMs: Number(process.env.MAX_MARKET_DATA_AGE_MS || 5000),
    orderBookValid,
    spreadPct,
    maxSpreadPct: Number(process.env.MAX_SPREAD_PCT || 1),
    risk,
    reconciliationHealthy: global.reconciliationHealthy !== false,
    killSwitch: global.killSwitch === true
  };
}

async function reserveExecutionIntent({ symbol, side, clientOrderId, payload = {} }) {
  if (!executionCoreReady || !executionIdempotency || !executionEventStore) {
    throw new Error('EXECUTION_CORE_NOT_READY');
  }

  const executionId = makeExecutionId(symbol, side, clientOrderId);
  const reservation = await executionIdempotency.reserve(executionId, {
    executionId,
    symbol,
    side,
    clientOrderId,
    fencingToken: currentFencingToken
  });

  if (!reservation.acquired) {
    throw new Error(`DUPLICATE_EXECUTION:${executionId}`);
  }

  const sm = new ExecutionStateMachine({
    state: ExecutionState.INTENT_CREATED
  });

  await executionEventStore.append({
    executionId,
    type: 'EXECUTION_INTENT_CREATED',
    state: sm.state,
    sequence: sm.version,
    fencingToken: currentFencingToken,
    payload
  });

  return { executionId, sm };
}

async function transitionExecution({ executionId, sm, next, payload = {} }) {
  sm.transition(next);
  await executionIdempotency.setStatus(executionId, sm.state, {
    fencingToken: currentFencingToken,
    stateVersion: sm.version
  });

  await executionEventStore.append({
    executionId,
    type: `EXECUTION_${sm.state}`,
    state: sm.state,
    sequence: sm.version,
    fencingToken: currentFencingToken,
    payload
  });

  return sm.snapshot();
}

async function executeProtected(symbol, fn) {
  return symbolExecutionLock.run(symbol, fn);
}

let isDbConnected = false, dbReconnectInterval = null, pendingClosedTrades = [], isReconnecting = false;
let criticalStateQueue = null;

const priceFailureCounts = new Map();
let isPaused = false, lastScanTime = null, lastTrackerCheckTime = null;
let trackerLock = false;
const signalPerformanceHistory = new Map();

const mlModel = new TensorFlowSignalModel({
  modelDir: process.env.ML_MODEL_DIR || './models/signal-model',
  minSamples: config.ML_MIN_TRAINING_SAMPLES,
  maxSamples: config.ML_MAX_TRAINING_SAMPLES,
  minPredictionProbability: config.ML_MIN_PREDICTION_PROBABILITY,
  strongSignalProbability: config.ML_STRONG_SIGNAL_PROBABILITY,
  epochs: config.ML_EPOCHS,
  batchSize: config.ML_BATCH_SIZE,
  logger
});

const dqnAgent = new DeepQTheTradingAgent({
  modelDir: process.env.DQN_MODEL_DIR || './models/rl-dqn-model',
  stateSize: 16,
  actionSize: 5,
  logger
});

const hedgeManager = new HedgeManager({ logger, thresholdDropPct: -2.5 });
const volManager = new VolatilitySurfaceManager({ logger });
const orderFlowManager = new OrderFlowAnalyzer({ logger });
const macroEngine = new MacroFilterEngine({ logger });

// Institutional AI Agent Suite: advisory/evaluation only. Hard risk controls remain authoritative.
const agentSuite = new InstitutionalAgentSuite();
const timesFMForecastAgent = new TimesFMForecastAgent({
  enabled: String(process.env.TIMESFM_ENABLED || 'false').toLowerCase() === 'true',
  logger,
  timeoutMs: Number(process.env.TIMESFM_TIMEOUT_MS || 15000)
});
const dynamicTimeStopAgent = new DynamicTimeStopAgent({
  timesFM: timesFMForecastAgent,
  timesFMWeight: Number(process.env.TIMESFM_WEIGHT || 0.30),
  maxExtensionHours: Number(process.env.DYNAMIC_TIME_STOP_MAX_EXTENSION_HOURS || 2),
  extensionStepHours: Number(process.env.DYNAMIC_TIME_STOP_EXTENSION_STEP_HOURS || 1),
  minTrendScoreToHold: Number(process.env.DYNAMIC_TIME_STOP_MIN_TREND_SCORE || 0.56)
});
const aiAgents = new AIAgentOrchestrator({ logger });
const walkForwardEngine = new WalkForwardEngine({ trainBars: Number(process.env.AI_WALK_FORWARD_TRAIN_BARS || 500), testBars: Number(process.env.AI_WALK_FORWARD_TEST_BARS || 150), stepBars: Number(process.env.AI_WALK_FORWARD_STEP_BARS || 150) });
const modelDriftMonitor = new ModelDriftMonitor({ windowSize: Number(process.env.AI_DRIFT_WINDOW || 200), threshold: Number(process.env.AI_DRIFT_THRESHOLD || 0.35) });
const agentAttribution = new AgentAttribution({ maxRecords: Number(process.env.AI_ATTRIBUTION_MAX_RECORDS || 5000) });
const safetyController = new SafetyController({ logger });
const portfolioLedger = new PortfolioLedger({ logger });
const readinessGate = new ProductionReadinessGate({ required: ['apiKeyConfigured','paperExecution','reconciliationHealthy','dataFeedHealthy','riskEngineHealthy','oosValidated','rollbackReady','auditTrail','independentOosEvidence','shadowValidated','reconciliationDrillPassed','securityReviewApproved','humanApproval'] });
const auditTrail = new AuditTrail();
auditTrail.append({ event: 'RUNTIME_START', version: '25.0.0-institutional-hardening', mode: 'PAPER_SHADOW' });

const jarvisEventBus = new JarvisEventBus({ maxEvents: Number(process.env.JARVIS_EVENT_BUFFER_SIZE || 1000), auditTrail, logger, replayDir: process.env.MARKET_DATA_DIR || './data/market-replay' });
jarvisEventBus.emitEvent('SYSTEM:READY', { version: '25.0.0', dashboardBuild: 'JARVIS-6.14-REAL-BOT-LINK', mode: 'PAPER_SHADOW' }, { source: 'runtime', persist: true, persistMinIntervalMs: 60000 });
const llmEngine = new GeminiLLMEngine({ apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL, enabled: config.AI_LLM_ENABLED, cooldownMs: config.AI_LLM_COOLDOWN_MS, logger });

let isModelTrained = false;
let lastMLTrainingStats = null;

function buildMLFeatures(data) {
  return mlModel.buildFeatures(data);
}

function buildDQNStateVector(params) {
  return [
    params.adx ? params.adx / 50 : 0.5,
    params.rsi ? params.rsi / 100 : 0.5,
    params.hurst || 0.5,
    params.relativeVolume ? Math.min(params.relativeVolume / 5, 1) : 0.2,
    params.signalScore ? params.signalScore / 100 : 0.5,
    params.direction === 'LONG' ? 1 : 0,
    params.marketPhase === 'TRENDING' ? 1 : 0,
    params.marketPhase === 'RANGING' ? 0.5 : 0,
    params.atrPct || 0.02,
    params.pocDistancePct || 0,
    params.vwapDistancePct || 0,
    params.orderBookImbalance || 1,
    params.spreadPct || 0.1,
    params.volatilityRatio || 1,
    params.mlProbability || 0.5,
    0.5
  ];
}

async function trainSignalMLModel(force = false) {
  if (!config.ML_ENABLED) return { trained: false, reason: 'disabled' };
  if (!closedTradesCollection || !isDbConnected) {
    logger.warn('[TensorFlow.js ML] Training übersprungen: MongoDB/closedTrades nicht verfügbar.');
    return { trained: false, reason: 'db-unavailable' };
  }
  try {
    logger.info(`🧠 [TensorFlow.js ML] Training angefordert | force=${force} | collection=closedTrades`);
    const result = await mlModel.trainFromTrades(closedTradesCollection, { force });
    isModelTrained = !!result.trained;
    lastMLTrainingStats = result;

    // DQN darf ein erfolgreiches TensorFlow-Training nicht nachträglich als
    // fehlgeschlagen melden. Beide Lernpfade werden getrennt behandelt.
    if (config.DQN_ENABLED) {
      try {
        await dqnAgent.trainFromClosedTrades(closedTradesCollection);
      } catch (dqnError) {
        logger.error(`[DQN Training Fehler]: ${dqnError.stack || dqnError.message}`);
      }
    }

    return result;
  } catch (e) {
    logger.error(`[TensorFlow.js ML Fehler beim Training]: ${e.stack || e.message}`);
    return { trained: false, reason: e.message };
  }
}

async function loadSignalMLModel() {
  if (!config.ML_ENABLED) return false;
  try {
    const loaded = await mlModel.load();
    isModelTrained = loaded;
    if (loaded) lastMLTrainingStats = mlModel.getStats();
    
    if (config.DQN_ENABLED) {
      await dqnAgent.init();
    }

    return loaded;
  } catch (e) {
    logger.warn(`[TensorFlow.js ML] Kein gespeichertes Modell geladen: ${e.message}`);
    return false;
  }
}

function predictSignalSuccess(features) {
  if (!config.ML_ENABLED || !isModelTrained) {
    return { probability: 0.5, class: 'UNKNOWN', confidence: 0, trained: false };
  }
  return mlModel.predict(features);
}

async function axiosGetWithRetry(url, options = {}, retries = 3, backoffMs = 1000) {
  if (Date.now() < kucoinCircuitOpenUntil) {
    throw new Error('KuCoin Circuit Breaker aktiv (API-Schutz)');
  }

  await apiRateLimiter.checkLimit();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const startTime = Date.now();
      const response = await axios.get(url, { timeout: options.timeout || 5000, ...options });
      apiLatencyStats.record('kucoin', Date.now() - startTime);
      kucoinErrorCount = 0;
      return response;
    } catch (error) {
      if (error.response && error.response.status === 429 && attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
      if (attempt === retries) {
        kucoinErrorCount++;
        if (kucoinErrorCount >= KUCOIN_CIRCUIT_THRESHOLD) {
          kucoinCircuitOpenUntil = Date.now() + KUCOIN_CIRCUIT_COOLDOWN_MS;
          logger.error(`🚨 KuCoin API Fehlerhäufung! Circuit Breaker für 5 Minuten aktiviert.`);
          sendTelegramAlert(`⚠️ <b>KuCoin API Schutz aktiv:</b> Zu viele Fehler. Scans pausieren für 5 Minuten.`);
        }
      }
      throw error;
    }
  }
}

const futuresApiSemaphore = {
  active: 0, queue: [],
  async acquire() {
    if (this.active < 6) { this.active++; return; }
    await new Promise(resolve => this.queue.push(resolve));
    this.active++;
  },
  release() {
    this.active--;
    if (this.queue.length > 0) this.queue.shift()();
  }
};

async function futuresApiGetWithRetry(url, options = {}, retries = 3, backoffMs = 1000) {
  await futuresApiSemaphore.acquire();
  try { return await axiosGetWithRetry(url, options, retries, backoffMs); }
  finally { futuresApiSemaphore.release(); }
}

async function processDbBulkQueue() {
  if (dbBulkQueue.length === 0 || !isDbConnected) return;
  const batch = [...dbBulkQueue];
  dbBulkQueue = [];
  try {
    const startTime = Date.now();
    const tradeOps = [], closeOps = [];
    for (const op of batch) {
      if (op.type === 'upsertTrade') tradeOps.push({ updateOne: { filter: { symbol: op.symbol }, update: { $set: op.data }, upsert: true } });
      else if (op.type === 'removeTrade') tradeOps.push({ deleteOne: { filter: { symbol: op.symbol } } });
      else if (op.type === 'insertClosed') closeOps.push({ insertOne: { document: op.data } });
    }
    if (tradeOps.length > 0) await tradesCollection.bulkWrite(tradeOps);
    if (closeOps.length > 0) await closedTradesCollection.bulkWrite(closeOps);
    apiLatencyStats.record('mongodb', Date.now() - startTime);
  } catch (e) {
    logger.error?.(`[DB-BULK] Persistenz fehlgeschlagen; Batch wird gepuffert: ${e.message}`);
    dbBulkQueue.push(...batch);
  }
}

async function loadPauseState() {
  if (!botStateCollection) return;
  try {
    const doc = await botStateCollection.findOne({ _id: 'botControl' });
    if (doc) isPaused = !!doc.isPaused;
  } catch (e) { logger.warn?.(`[STATE] botControl-Laden fehlgeschlagen: ${e.message}`); }
}

async function persistPauseState() {
  if (!botStateCollection || !isDbConnected) { riskEngine.setKillSwitch(true, 'state-persistence-unavailable:botControl'); return false; }
  try { await botStateCollection.updateOne({ _id: 'botControl' }, { $set: { isPaused } }, { upsert: true }); } catch (e) { logger.error?.(`[STATE] botControl-Persistenz fehlgeschlagen: ${e.message}`); riskEngine.setKillSwitch(true, 'state-persistence-failed:botControl'); return false; }
}

let lastMLHistoryRecoveryAt = 0;

async function recoverHistoricalMLDataOnStartup() {
  if (String(process.env.ML_AUTO_RECOVERY || 'true').toLowerCase() === 'false') return;
  if (!isDbConnected || !closedTradesCollection || !paperOrdersCollection || !db) return;

  // Avoid repeated full scans during a short Mongo reconnect storm.
  if (Date.now() - lastMLHistoryRecoveryAt < 10 * 60 * 1000) return;
  lastMLHistoryRecoveryAt = Date.now();

  try {
    const {
      indexPaperOrders,
      indexExecutionIntents,
      indexExecutionEvents,
      findExactPaperOrder,
      findExactExecutionSource,
      recoverTrade
    } = require('./ml-history-recovery');

    const recoveryLimit = Math.max(1, Number(process.env.ML_RECOVERY_LIMIT || 2000));

    const [trades, orders, intents, events] = await Promise.all([
      closedTradesCollection.find({
        isPartial: { $ne: true },
        pnlUSD: { $exists: true, $ne: null }
      }).sort({ closeTime: -1 }).limit(recoveryLimit).toArray(),
      paperOrdersCollection.find({}).sort({ simulatedAt: 1 }).limit(Math.max(recoveryLimit * 2, 5000)).toArray(),
      db.collection('executionIntents').find({}).sort({ createdAt: 1 }).limit(Math.max(recoveryLimit * 2, 5000)).toArray(),
      db.collection('executionEvents').find({}).sort({ createdAt: 1, sequence: 1 }).limit(Math.max(recoveryLimit * 5, 10000)).toArray()
    ]);

    // In paper mode the adapter is the authoritative in-memory/recovered
    // execution ledger. Render restarts can temporarily have an empty
    // `paperOrders` collection while the adapter has already restored its
    // 23+ fills from its durable state. Include those exact orders in ML
    // recovery instead of treating the historical entry price as lost.
    const adapterOrders = typeof paperExecutionAdapter?.getOrders === 'function'
      ? paperExecutionAdapter.getOrders()
      : [];
    const mergedPaperOrders = [...orders];
    const seenPaperOrderIds = new Set(mergedPaperOrders.map(o => String(o?.orderId || o?._id || '')));
    for (const order of adapterOrders) {
      const id = String(order?.orderId || order?._id || '');
      if (id && !seenPaperOrderIds.has(id)) {
        mergedPaperOrders.push(order);
        seenPaperOrderIds.add(id);
      }
    }

    const paperIndex = indexPaperOrders(mergedPaperOrders);
    const intentIndex = indexExecutionIntents(intents);
    const eventIndex = indexExecutionEvents(events);

    let eligible = 0;
    let recoverable = 0;
    let updated = 0;
    let unresolved = 0;
    let paperCount = 0;
    let eventCount = 0;
    let missingSignalOnly = 0;
    let missingEntryOnly = 0;
    let missingBoth = 0;
    const unresolvedReasons = { noExactSource: 0, sourceWithoutUsablePrice: 0 };
    const adapterOrderCount = adapterOrders.length;

    for (const trade of trades) {
      const missingSignalPrice = !(Number.isFinite(Number(trade.signalPriceAtEntry)) && Number(trade.signalPriceAtEntry) > 0);
      const missingEntry = !(Number.isFinite(Number(trade.entry)) && Number(trade.entry) > 0);
      if (!missingSignalPrice && !missingEntry) continue;

      eligible++;
      if (!missingSignalPrice && missingEntry) missingEntryOnly++;
      else if (missingSignalPrice && !missingEntry) missingSignalOnly++;
      else if (missingSignalPrice && missingEntry) missingBoth++;

      const paperMatch = findExactPaperOrder(trade, paperIndex);
      const executionMatch = paperMatch.order
        ? { intent: null, event: null, source: null, sourceId: null }
        : findExactExecutionSource(trade, intentIndex, eventIndex);

      if (!paperMatch.order && !executionMatch.event && !executionMatch.intent) {
        unresolved++;
        unresolvedReasons.noExactSource++;
        continue;
      }

      const { patch, reasons } = recoverTrade(trade, paperMatch.order, executionMatch);
      if (!Object.keys(patch).length) {
        unresolved++;
        unresolvedReasons.sourceWithoutUsablePrice++;
        continue;
      }

      recoverable++;

      const result = await closedTradesCollection.updateOne(
        { _id: trade._id },
        { $set: patch }
      );

      if (result.modifiedCount > 0) updated++;
      if (paperMatch.order) paperCount++;
      else eventCount++;

      logger.info?.(`[ML-RECOVERY] ${trade._id} ${trade.symbol || ''} ${reasons.join(', ')}`);
    }

    logger.info?.(
      `[ML-RECOVERY] v3 complete scanned=${trades.length} eligible=${eligible} ` +
      `recoverable=${recoverable} updated=${updated} unresolved=${unresolved} ` +
      `paperOrders=${paperCount} executionEvents=${eventCount} adapterOrders=${adapterOrderCount} ` +
      `missingSignalOnly=${missingSignalOnly} missingEntryOnly=${missingEntryOnly} missingBoth=${missingBoth} ` +
      `unresolvedReasons=${JSON.stringify(unresolvedReasons)}`
    );
  } catch (err) {
    // Recovery is non-critical to execution safety. If it fails, normal ML
    // training remains fail-closed and the bot continues in its existing mode.
    logger.warn?.(`[ML-RECOVERY] v3 skipped: ${err.message}`);
  }
}

let currentInstanceId = null;
let currentLockToken = null;
let lockHeartbeatInterval = null;
let lockHeartbeatInFlight = false;
let lockHeartbeatFailures = 0;
let lockLastHeartbeatAt = 0;

function createInstanceLockIdentity() {
  // Never use a static Render env var as the actual lease owner. If two
  // processes share INSTANCE_ID, the old implementation allowed both to
  // satisfy `{ instanceId }` and therefore both to acquire the singleton.
  // Keep the configured value as a human-readable prefix, but make every
  // process/boot unique with pid + timestamp + UUID.
  const prefix = String(process.env.INSTANCE_ID || 'primary').replace(/[^a-zA-Z0-9._:-]/g, '_');
  return `${prefix}-${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
}

async function tryAcquireLockOnce(instanceId, lockToken) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - config.LOCK_STALE_AFTER_MS);

  // Ensure the singleton document exists. The actual claim below remains a
  // single atomic MongoDB operation, so two starters cannot both win.
  await lockCollection.updateOne(
    { _id: 'instanceLock' },
    {
      $setOnInsert: {
        instanceId: null,
        lockToken: null,
        lastSeen: new Date(0),
        acquiredAt: null,
        heartbeatCount: 0
      }
    },
    { upsert: true }
  );

  const result = await lockCollection.findOneAndUpdate(
    {
      _id: 'instanceLock',
      $or: [
        { instanceId: null },
        { instanceId },
        { lastSeen: { $lt: staleBefore } }
      ]
    },
    {
      $set: {
        instanceId,
        lockToken,
        lastSeen: now,
        acquiredAt: now
      },
      $inc: { heartbeatCount: 1 }
    },
    { returnDocument: 'after' }
  );

  const doc = result?.value || result;
  return doc?.instanceId === instanceId && doc?.lockToken === lockToken;
}

async function acquireInstanceLock() {
  const instanceId = createInstanceLockIdentity();
  const lockToken = crypto.randomUUID();

  try {
    // Always wait long enough for a genuinely dead owner's lease to expire.
    // This prevents the old 30*2s-style retry budget from giving up before a
    // stale lease can be reclaimed.
    const retryDelay = Math.max(250, config.LOCK_ACQUIRE_RETRY_DELAY_MS);
    const minWaitMs = config.LOCK_STALE_AFTER_MS + (3 * retryDelay);
    const configuredWaitMs = config.LOCK_ACQUIRE_RETRIES * retryDelay;
    const totalWaitMs = Math.max(minWaitMs, configuredWaitMs);
    const maxAttempts = Math.max(config.LOCK_ACQUIRE_RETRIES, Math.ceil(totalWaitMs / retryDelay));
    const deadline = Date.now() + totalWaitMs;

    logger.info(`[INSTANCE-LOCK] attempting owner=${instanceId} staleAfterMs=${config.LOCK_STALE_AFTER_MS} heartbeatMs=${config.LOCK_HEARTBEAT_INTERVAL_MS}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const acquired = await tryAcquireLockOnce(instanceId, lockToken);
      if (acquired) {
        currentInstanceId = instanceId;
        currentLockToken = lockToken;
        lockLastHeartbeatAt = Date.now();
        lockHeartbeatFailures = 0;
        startLockHeartbeat(instanceId, lockToken);
        logger.info(`[INSTANCE-LOCK] acquired owner=${instanceId} attempt=${attempt} token=${lockToken.slice(0, 8)}`);
        return instanceId;
      }

      if (Date.now() >= deadline) break;

      let ownerInfo = '';
      try {
        const lockDoc = await lockCollection.findOne({ _id: 'instanceLock' });
        if (lockDoc?.instanceId) {
          const ageMs = lockDoc.lastSeen ? Math.max(0, Date.now() - new Date(lockDoc.lastSeen).getTime()) : null;
          const remainingLeaseMs = ageMs === null ? null : Math.max(0, config.LOCK_STALE_AFTER_MS - ageMs);
          ownerInfo = ` owner=${lockDoc.instanceId} ageMs=${ageMs ?? 'unknown'} remainingLeaseMs=${remainingLeaseMs ?? 'unknown'} staleAfterMs=${config.LOCK_STALE_AFTER_MS}`;
        }
      } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }

      const remainingMs = Math.max(0, deadline - Date.now());
      logger.warn(`[INSTANCE-LOCK] busy; retry ${attempt}/${maxAttempts} remainingMs=${remainingMs}${ownerInfo}`);
      await sleep(Math.min(retryDelay, remainingMs));
    }

    logger.error(`[INSTANCE-LOCK] acquisition timeout after ${totalWaitMs}ms; owner=${instanceId}`);
    await sendTelegramAlert('🚨 <b>Instance-Lock fehlgeschlagen!</b> Bot wird beendet.');
    process.exit(1);
  } catch (e) {
    logger.error(`🔴 Kritischer Fehler beim Instance-Lock – ${e.message}`);
    await sendTelegramAlert('🚨 <b>Instance-Lock Fehler!</b> Bot wird beendet.');
    process.exit(1);
  }
}

async function releaseInstanceLock() {
  if (!lockCollection || !isDbConnected || !currentInstanceId || !currentLockToken) return;
  try {
    const result = await lockCollection.updateOne(
      { _id: 'instanceLock', instanceId: currentInstanceId, lockToken: currentLockToken },
      {
        $set: {
          instanceId: null,
          lockToken: null,
          lastSeen: new Date(0),
          releasedAt: new Date()
        }
      }
    );
    if (result.modifiedCount === 1) {
      logger.info(`[INSTANCE-LOCK] released owner=${currentInstanceId}`);
    } else {
      logger.warn(`[INSTANCE-LOCK] release skipped: ownership already changed owner=${currentInstanceId}`);
    }
  } catch (e) {
    logger.warn?.(`[INSTANCE-LOCK] release failed: ${e.message}`);
  } finally {
    currentInstanceId = null;
    currentLockToken = null;
  }
}

function startLockHeartbeat(instanceId, lockToken) {
  if (lockHeartbeatInterval) clearInterval(lockHeartbeatInterval);

  lockHeartbeatInterval = setInterval(async () => {
    if (lockHeartbeatInFlight || !isDbConnected || !lockCollection) return;
    lockHeartbeatInFlight = true;

    try {
      const now = new Date();
      const result = await lockCollection.updateOne(
        { _id: 'instanceLock', instanceId, lockToken },
        {
          $set: { lastSeen: now, heartbeatAt: now },
          $inc: { heartbeatCount: 1 }
        }
      );

      if (result.modifiedCount !== 1) {
        lockHeartbeatFailures++;
        logger.error(`[INSTANCE-LOCK] OWNERSHIP LOST owner=${instanceId} token=${lockToken.slice(0, 8)} failures=${lockHeartbeatFailures}`);
        clearInterval(lockHeartbeatInterval);
        lockHeartbeatInterval = null;
        executionCoreReady = false;
        isPaused = true;
        return;
      }

      lockHeartbeatFailures = 0;
      lockLastHeartbeatAt = Date.now();
    } catch (e) {
      lockHeartbeatFailures++;
      const heartbeatAgeMs = Date.now() - lockLastHeartbeatAt;
      logger.warn(`[INSTANCE-LOCK] heartbeat failed ${lockHeartbeatFailures}: ${e.message} ageMs=${heartbeatAgeMs}`);

      // Fail closed before the lease could become stale. The separate
      // execution fencing lease also pauses execution if it cannot renew.
      if (heartbeatAgeMs >= Math.max(10000, Math.floor(config.LOCK_STALE_AFTER_MS / 2))) {
        executionCoreReady = false;
        isPaused = true;
        logger.error(`[INSTANCE-LOCK] heartbeat unhealthy for ${heartbeatAgeMs}ms; trading paused fail-closed`);
      }
    } finally {
      lockHeartbeatInFlight = false;
    }
  }, config.LOCK_HEARTBEAT_INTERVAL_MS);

  lockHeartbeatInterval.unref?.();
}

async function loadPersistedFilterState() {
  if (!botStateCollection) return;
  try {
    const doc = await botStateCollection.findOne({ _id: 'dynamicFilterState' });
    if (doc) {
      if (doc.configValues) {
        Object.keys(doc.configValues).forEach(key => {
          config[key] = doc.configValues[key];
        });
      }
      if (doc.filterState) {
        Object.keys(doc.filterState).forEach(key => {
          if (filterState[key]) {
            filterState[key] = doc.filterState[key];
          }
        });
      }
      logger.info('✅ Dynamische Filter-Konfiguration aus DB geladen');
    }
  } catch (e) {
    logger.error(`Fehler beim Laden des DynamicFilterState: ${e.message}`);
  }
}

async function persistFilterState() {
  if (!botStateCollection || !isDbConnected) return;
  try {
    const configValues = {};
    Object.keys(FILTER_REGISTRY).forEach(k => {
      const cKey = FILTER_REGISTRY[k].configKey;
      configValues[cKey] = config[cKey];
    });
    await botStateCollection.updateOne(
      { _id: 'dynamicFilterState' },
      { $set: { configValues, filterState, lastUpdated: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    logger.error(`Fehler beim Speichern des FilterState: ${e.message}`);
  }
}

async function logFilterChange(filterKey, action, oldValue, newValue, user = 'TelegramUser') {
  if (filterChangeLogCollection && isDbConnected) {
    try {
      await filterChangeLogCollection.insertOne({
        timestamp: new Date(),
        filterKey,
        action,
        oldValue,
        newValue,
        user
      });
    } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); }
  }
  logger.info(`⚙️ [FILTER CHANGE] ${filterKey} (${action}): ${oldValue} -> ${newValue}`);
}

async function initDatabase() {
  try {
    const startTime = Date.now();
    await client.connect();
    db = client.db('tradingBotDB');
    tradesCollection = db.collection('activeTrades');
    closedTradesCollection = db.collection('closedTrades');
    botStateCollection = db.collection('botState');
    lockCollection = db.collection('locks');
    marketPhaseLogsCollection = db.collection('marketPhaseLogs');
    filterChangeLogCollection = db.collection('filterChangeLogs');
    paperOrdersCollection = db.collection('paperOrders');
    executionIdempotencyCollection = db.collection('executionIdempotency');

    // Wire persistence after the DB connection is known to be healthy.
    paperExecutionIdempotency.collection = executionIdempotencyCollection;
    paperExecutionAdapter.collection = paperOrdersCollection;
    reconciliationEngine = new ReconciliationEngine({
      getBotTrades: () => activeTrades,
      executionAdapter: paperExecutionAdapter,
      logger
    });

    isDbConnected = true;
    if (!criticalStateQueue) {
      criticalStateQueue = new CriticalStateQueue({
        isHealthy: () => isDbConnected === true && Boolean(tradesCollection && closedTradesCollection),
        logger
      });
    }
    // Acquire the process/instance lock BEFORE initializing the execution core.
    // The fencing lease uses the same stable currentInstanceId; initializing it
    // before the lock made the execution core race startup and also left the
    // fencing identity undefined.
    const acquiredInstanceId = await acquireInstanceLock();
    if (!acquiredInstanceId) throw new Error('INSTANCE_LOCK_NOT_ACQUIRED');

    try {
      await initializeExecutionCore();
      if (!executionCoreReady) throw new Error('EXECUTION_CORE_NOT_READY');
      await runExecutionRecovery();
      executionLeaseHeartbeat = setInterval(() => {
        renewExecutionLease().catch(err => {
          logger.error?.(`[EXECUTION] lease heartbeat failed: ${err.message}`);
          executionCoreReady = false;
          isPaused = true;
        });
      }, 5000);
      intervalTimers.push(executionLeaseHeartbeat);
    } catch (err) {
      logger.error?.(`[EXECUTION] core init failed: ${err.message}`);
      executionCoreReady = false;
      isPaused = true;
      throw err;
    }

    apiLatencyStats.record('mongodb', Date.now() - startTime);
    logger.info('✅ Datenbank erfolgreich verbunden');

    try {
      await tradesCollection.createIndex({ symbol: 1 }, { unique: true });
      await closedTradesCollection.createIndex({ closeTime: -1 });
      await closedTradesCollection.createIndex({ symbol: 1, closeTime: -1 });
      await marketPhaseLogsCollection.createIndex({ timestamp: -1 });
      await filterChangeLogCollection.createIndex({ timestamp: -1 });
      await paperOrdersCollection.createIndex({ symbol: 1, simulatedAt: -1 });
      await executionIdempotencyCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
    } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); }

    if (dbReconnectInterval) { clearInterval(dbReconnectInterval); dbReconnectInterval = null; }
    const runtimeDoc = await botStateCollection.findOne({ _id: 'runtimeConfig' });
    if (runtimeDoc) {
      if (runtimeDoc.CAPITAL_USD) config.CAPITAL_USD = runtimeDoc.CAPITAL_USD;
      if (runtimeDoc.LEVERAGE) config.LEVERAGE = runtimeDoc.LEVERAGE;
      if (runtimeDoc.RISK_PERCENT) config.RISK_PERCENT = runtimeDoc.RISK_PERCENT;
    }

    const blDoc = await botStateCollection.findOne({ _id: 'manualBlacklist' });
    if (blDoc && Array.isArray(blDoc.symbols)) {
      blDoc.symbols.forEach(s => manualBlacklist.add(s));
    }

    await loadPersistedFilterState();
    await loadDailyPnLState();
    await loadPauseState();

    const pnlDoc = await botStateCollection.findOne({ _id: 'peakCapital' });
    if (pnlDoc) peakCapital = Math.max(config.CAPITAL_USD, pnlDoc.value);

    const savedTrades = await tradesCollection.find({}).toArray();
    savedTrades.forEach(trade => activeTrades.set(trade.symbol, trade));

    if (config.PAPER_EXECUTION_ENABLED) {
      await paperExecutionAdapter.restore();
      for (const trade of activeTrades.values()) {
        if (!trade.paperOrderId && !paperExecutionAdapter.getPosition(trade.symbol)) {
          const legacyPosition = await paperExecutionAdapter.bootstrapLegacyPosition(trade);
          if (legacyPosition) {
            trade.paperOrderId = legacyPosition.orderId;
            trade.executionStatus = 'FILLED_LEGACY_BOOTSTRAP';
            await upsertTrade(trade.symbol, trade);
          }
        }
      }
      const recon = reconciliationEngine.reconcile();
      if (!recon.healthy) {
        isPaused = true;
        global.reconciliationHealthy = false;
        logger.error('🚫 [RECONCILIATION] Inkonsistenter Paper-State nach Restart – Bot pausiert.');
      }
    }

    // STEP 3: recovery/reconciliation is deliberately the final startup gate.
    // DB state and paper positions must already be restored before any UNKNOWN
    // execution is queried. A failed reconciliation always leaves trading paused.
    await runExecutionRecovery();
    await recoverHistoricalMLDataOnStartup();

    if (dbBulkTimer) clearInterval(dbBulkTimer);
    dbBulkTimer = setInterval(processDbBulkQueue, config.DB_BULK_INTERVAL_MS);
  } catch (e) {
    logger.error(`🔴 Datenbank-Verbindungsfehler: ${e.message}`);
    isDbConnected = false;
    scheduleDbReconnect();
  }
}

// Starts (if not already running) a periodic retry loop that tries to
// re-establish the MongoDB connection every 5s. Only one interval is ever
// active at a time; initDatabase()'s success path clears it once a
// reconnect succeeds, so this loop is self-terminating. Scans and the
// tracker already refuse to run while isDbConnected is false (see
// scanMarket()'s isDbConnected/isPaused guard), so no trading decisions
// are made off a stale/disconnected DB state while this is in progress.
function scheduleDbReconnect() {
  if (dbReconnectInterval || isShuttingDown) return;
  logger.warn('🔁 Starte MongoDB-Reconnect-Versuche (alle 5s)...');
  dbReconnectInterval = setInterval(() => { ensureDbConnection(); }, 5000);
}

async function ensureDbConnection() {
  if (isDbConnected || isReconnecting || isShuttingDown) return isDbConnected;
  isReconnecting = true;
  try {
    await initDatabase();
    if (isDbConnected) logger.info('✅ MongoDB-Reconnect erfolgreich.');
  } finally {
    isReconnecting = false;
  }
  return isDbConnected;
}

async function loadDailyPnLState() {
  if (!botStateCollection) return;
  try {
    const doc = await botStateCollection.findOne({ _id: 'dailyPnL' });
    if (doc && doc.dateUTC === todayUTCString()) {
      dailyNetPnL = doc.value || 0;
    } else {
      dailyNetPnL = 0;
      await persistDailyPnLState();
    }
  } catch (e) { logger.error?.(`[STATE] dailyPnL-Laden fehlgeschlagen: ${e.message}`); riskEngine.setKillSwitch(true, 'state-load-failed:dailyPnL'); throw e; }
}

async function persistDailyPnLState() {
  if (!botStateCollection || !isDbConnected) { riskEngine.setKillSwitch(true, 'state-persistence-unavailable:dailyPnL'); return false; }
  try { await botStateCollection.updateOne({ _id: 'dailyPnL' }, { $set: { value: dailyNetPnL, dateUTC: todayUTCString() } }, { upsert: true }); } catch (e) { logger.error?.(`[STATE] dailyPnL-Persistenz fehlgeschlagen: ${e.message}`); riskEngine.setKillSwitch(true, 'state-persistence-failed:dailyPnL'); return false; }
}

async function persistPeakCapital() {
  if (!botStateCollection || !isDbConnected) { riskEngine.setKillSwitch(true, 'state-persistence-unavailable:peakCapital'); return false; }
  try { await botStateCollection.updateOne({ _id: 'peakCapital' }, { $set: { value: peakCapital } }, { upsert: true }); } catch (e) { logger.error?.(`[STATE] peakCapital-Persistenz fehlgeschlagen: ${e.message}`); riskEngine.setKillSwitch(true, 'state-persistence-failed:peakCapital'); return false; }
}

async function persistCriticalState(operation, label) {
  if (!criticalStateQueue) {
    throw new Error('CRITICAL_STATE_QUEUE_NOT_READY');
  }
  try {
    return await criticalStateQueue.enqueue(operation, label);
  } catch (err) {
    isPaused = true;
    global.reconciliationHealthy = false;
    logger.error?.(`[STATE-QUEUE] ${label} -> TRADING PAUSED: ${err.message}`);
    throw err;
  }
}

async function upsertTrade(symbol, tradeData) {
  if (!tradesCollection || !isDbConnected) {
    isPaused = true;
    throw new Error('CRITICAL_STATE_DB_UNHEALTHY');
  }

  // Persist first; only then publish the new state to the in-memory runtime.
  await persistCriticalState(
    () => tradesCollection.updateOne(
      { symbol },
      { $set: { ...tradeData, symbol } },
      { upsert: true }
    ),
    `upsertTrade:${symbol}`
  );

  activeTrades.set(symbol, tradeData);
}

async function executePaperExecutionThroughCore({
  symbol,
  direction,
  clientOrderId,
  action,
  quantity,
  referencePrice,
  fillPriceOverride = null,
  reason = 'runtime',
  orderBookValid = false,
  spreadPct = Infinity,
  marketDataAgeMs = Infinity,
  risk = { allowed: false, reason: 'UNKNOWN' },
  riskContext = null
}) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SELL' : 'BUY';

  riskEngine.assertExecutionAllowed({ action, proposed: riskContext?.proposed || { notionalUSD: Number(quantity) * Number(referencePrice) }, reducedSize: riskContext?.reducedSize === true });

  return protectedSubmit({
    symbol,
    side,
    clientOrderId,
    payload: {
      action,
      quantity,
      referencePrice,
      fillPriceOverride,
      reason
    },
    riskContext: buildPreTradeContext({
      orderBookValid,
      spreadPct,
      marketDataAgeMs,
      risk,
      riskState: riskEngine.snapshot()
    }),
    orderBookValid,
    spreadPct,
    marketDataAgeMs,
    reserveExecutionIntent,
    transitionExecution,
    submitter: async ({ action: submitAction, quantity: submitQty, referencePrice: submitPrice, fillPriceOverride: override, reason: submitReason }) => {
      if (submitAction === 'OPEN') {
        return paperExecutionAdapter.submitMarketOrder({
          signalId: clientOrderId,
          symbol,
          direction,
          quantity: submitQty,
          referencePrice: submitPrice
        });
      }

      if (submitAction === 'REDUCE') {
        return paperExecutionAdapter.reducePosition({
          symbol,
          quantity: submitQty,
          referencePrice: submitPrice,
          fillPriceOverride: override,
          reason: submitReason
        });
      }

      if (submitAction === 'CLOSE') {
        return paperExecutionAdapter.closePosition({
          symbol,
          referencePrice: submitPrice,
          fillPriceOverride: override,
          reason: submitReason
        });
      }

      throw new Error(`UNSUPPORTED_PAPER_EXECUTION_ACTION:${submitAction}`);
    },
    logger
  });
}

async function removeTrade(symbol, closedTradeRecord = null) {
  const trade = activeTrades.get(symbol);
  if (trade) {
    // Always preserve the complete entry-time feature snapshot when a trade is closed.
    // Callers historically passed only close-time fields (pnl/exit/reason), which
    // caused closedTrades to lose the ML features collected at signal/entry.
    // Merge the durable active trade first, then apply close-time fields on top.
    const finalRecord = {
      ...trade,
      ...(closedTradeRecord || {}),
      closeTime: closedTradeRecord?.closeTime || Date.now(),
      closeReason: closedTradeRecord?.closeReason || trade.closeReason || 'manual/unknown'
    };

    if (config.PAPER_EXECUTION_ENABLED && paperExecutionAdapter.getPosition(symbol)) {
      try {
        const closeExecution = await executePaperExecutionThroughCore({
          symbol,
          direction: trade.direction === 'LONG' ? 'SHORT' : 'LONG',
          clientOrderId: `close:${trade.signalId || symbol}:${finalRecord.closeReason || 'unknown'}`,
          action: 'CLOSE',
          quantity: Number(trade.positionSizeUnits),
          referencePrice: Number(finalRecord.exitPrice || trade.entry),
          fillPriceOverride: finalRecord.exitPrice || null,
          reason: finalRecord.closeReason || 'unknown',
          orderBookValid: true,
          spreadPct: 0,
          marketDataAgeMs: 0,
          risk: { allowed: true, reason: 'POSITION_CLOSE' }
        });

        if (closeExecution?.remote) {
          finalRecord.paperExitOrderId = closeExecution.remote.orderId;
          finalRecord.executionExitFeeUSD = closeExecution.remote.feeUSD;
          finalRecord.executionExitPrice = closeExecution.remote.avgFillPrice;
          finalRecord.executionLatencyMs = Math.max(
            Number(finalRecord.executionLatencyMs || 0),
            Number(closeExecution.remote.latencyMs || 0)
          );
        }
      } catch (e) {
        logger.error(`[PAPER CLOSE] ${symbol} fehlgeschlagen: ${e.message}`);
        finalRecord.executionStatus = 'CLOSE_EXECUTION_ERROR';
        // Never delete the active position unless the execution has definitely
        // completed. A failed/ambiguous close must remain reconcilable.
        isPaused = true;
        global.reconciliationHealthy = false;
        return;
      }
    }

    await persistClosedTradeRecord(finalRecord);

    // Delete the durable active state before deleting the in-memory state.
    await persistCriticalState(
      () => tradesCollection.deleteOne({ symbol }),
      `removeTrade:${symbol}`
    );
    activeTrades.delete(symbol);
  }
  priceFailureCounts.delete(symbol);
}

async function persistClosedTradeRecord(record) {
  if (!closedTradesCollection || !isDbConnected) {
    isPaused = true;
    global.reconciliationHealthy = false;
    throw new Error('CRITICAL_STATE_DB_UNHEALTHY');
  }

  await persistCriticalState(
    () => closedTradesCollection.insertOne(record),
    `insertClosed:${record.symbol}:${record.closeTime || Date.now()}`
  );

  updateSignalHistory(record);
  updateStreak(record.pnlUSD || 0);
}

function updateSignalHistory(record) {
  if (record.isPartial) return;
  const key = `${record.symbol}_${record.direction}`;
  const history = signalPerformanceHistory.get(key) || { signals: 0, wins: 0, totalPnL: 0, lastUpdate: Date.now() };
  history.signals++;
  history.totalPnL += (record.pnlUSD || 0);
  if ((record.pnlUSD || 0) > 0) history.wins++;
  history.lastUpdate = Date.now();
  signalPerformanceHistory.set(key, history);
}

function updateStreak(pnl) {
  if (pnl > 0) {
    currentStreak = currentStreak > 0 ? currentStreak + 1 : 1;
    maxWinStreak = Math.max(maxWinStreak, currentStreak);
  } else if (pnl < 0) {
    currentStreak = currentStreak < 0 ? currentStreak - 1 : -1;
    maxLossStreak = Math.min(maxLossStreak, currentStreak);
  }
}

function shouldSkipSignal(symbol, direction, score) {
  const key = `${symbol}_${direction}`;
  const history = signalPerformanceHistory.get(key);
  if (!history || history.signals < 3) return false;
  if (history.wins === 0 && history.signals >= 3) return true;
  if (score < 45 && history.totalPnL < 0) return true;
  return false;
}

async function isCoinDynamicallyBlacklisted(symbol) {
  if (manualBlacklist.has(symbol)) return true;
  try {
    if (!closedTradesCollection || !isDbConnected) return false;
    const recentTrades = await closedTradesCollection
      .find({ symbol: symbol })
      .sort({ closeTime: -1 })
      .limit(3)
      .toArray();

    if (recentTrades.length < 2) return false;

    const recentConsecutiveLosses = recentTrades.every(t => (t.pnlUSD || 0) < 0);
    if (recentConsecutiveLosses) {
      const lastCloseTime = new Date(recentTrades[0].closeTime).getTime();
      const hoursSinceLoss = (Date.now() - lastCloseTime) / (1000 * 60 * 60);

      if (hoursSinceLoss < 12) {
        logger.info(`🧠 [AI-Learning] Coin ${symbol} wurde temporär gesperrt wegen 2 Verlusten in Folge.`);
        return true;
      }
    }
  } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); }
  return false;
}

// ==========================================
// 9. RISIKOMANAGEMENT & DYNAMISCHER ATR
// ==========================================
function calculateDynamicLeverage(atr, currentPrice, baseLeverage = config.LEVERAGE) {
  if (!currentPrice || currentPrice === 0 || !atr || atr === 0) return baseLeverage;
  const volatilityPercent = (atr / currentPrice) * 100;
  let adjustedLeverage = baseLeverage;

  if (volatilityPercent > 3.0) {
    adjustedLeverage = Math.max(1, Math.floor(baseLeverage * 0.5));
  } else if (volatilityPercent > 2.0) {
    adjustedLeverage = Math.max(1, Math.floor(baseLeverage * 0.75));
  }
  return Number(adjustedLeverage);
}

function checkGlobalDrawdown(currentEquity) {
  peakCapital = Math.max(peakCapital, currentEquity);
  const drawdown = peakCapital > 0 ? (peakCapital - currentEquity) / peakCapital * 100 : 0;
  if (drawdown > config.MAX_DRAWDOWN_PERCENT) {
    sendDeduplicatedAlert('global_drawdown', `🔴 <b>MAX DRAWDOWN ERREICHT: ${drawdown.toFixed(1)}%!</b>\nBot wurde pausiert.`);
    isPaused = true;
    safetyController.set('pause', true, 'risk-limit');
    persistPauseState();
    persistPeakCapital();
    return true;
  }
  return false;
}

async function evaluateFundingAndSentiment(fundingRate, direction) {
  if (fundingRate === null || fundingRate === undefined) return { allowed: true };
  
  if (fundingRate > config.MAX_FUNDING_RATE) {
    if (direction === 'LONG') {
      return { allowed: false, reason: 'fundingRateTooHighLongsOvercrowded' };
    }
  } else if (fundingRate < config.MIN_FUNDING_RATE) {
    if (direction === 'SHORT') {
      return { allowed: false, reason: 'fundingRateTooLowShortsOvercrowded' };
    }
  }
  return { allowed: true };
}

function checkDailyProfitTarget() {
  if (config.DAILY_PROFIT_TARGET > 0 && dailyNetPnL >= config.DAILY_PROFIT_TARGET) {
    isPaused = true;
    safetyController.set('pause', true, 'risk-limit');
    persistPauseState();
    sendDeduplicatedAlert('daily_profit_target', `🎯 <b>TÄGLICHES PROFIT-ZIEL ERREICHT!</b>\nProfit heute: $${dailyNetPnL.toFixed(2)}`);
    return true;
  }
  return false;
}

async function recordTradePnL(pnlUSD, meta = {}) {
  const eventId = meta.eventId || `pnl:${meta.symbol || 'portfolio'}:${meta.closeTime || Date.now()}:${Number(pnlUSD).toFixed(8)}`;
  portfolioLedger.append({ eventId, type: 'REALIZED_PNL', symbol: meta.symbol || null, realizedPnLUSD: Number(pnlUSD) || 0, feeUSD: Number(meta.feeUSD || 0), fundingUSD: Number(meta.fundingUSD || 0), closeReason: meta.closeReason || null });
  dailyNetPnL += pnlUSD;
  await persistDailyPnLState();
  const currentEquity = config.CAPITAL_USD + dailyNetPnL;
  if (currentEquity > peakCapital) {
    peakCapital = currentEquity;
    await persistPeakCapital();
  }
  if (pnlUSD < 0) {
    consecutiveLosses++;
    if (config.MAX_CONSECUTIVE_LOSSES > 0 && consecutiveLosses >= config.MAX_CONSECUTIVE_LOSSES) {
      isPaused = true;
      persistPauseState();
      sendDeduplicatedAlert(
        'max_consecutive_losses',
        `🔴 <b>MAX_CONSECUTIVE_LOSSES (${config.MAX_CONSECUTIVE_LOSSES}) erreicht!</b> Bot pausiert.`,
        0
      );
    }
  } else {
    consecutiveLosses = 0;
  }
  checkDailyProfitTarget();
}

function calculateDynamicATRMultiplier(candles) {
  if (!candles || candles.length < 30) return config.ATR_STOP_MULT;
  const recentATR = calculateATR(candles.slice(-14), 14);
  const historicalATR = calculateATR(candles, 30);
  if (historicalATR === 0) return config.ATR_STOP_MULT;
  
  const volatilityRatio = recentATR / historicalATR;
  if (volatilityRatio > 1.5) return config.ATR_STOP_MULT * 1.25;
  if (volatilityRatio < 0.7) return config.ATR_STOP_MULT * 0.9;
  return config.ATR_STOP_MULT;
}

function calculateSharpeRatio(dailyReturns, riskFreeRate = 0.02) {
  if (dailyReturns.length < 2) return 0;
  const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : ((avgReturn - riskFreeRate / 365) / stdDev) * Math.sqrt(365);
}

function calculatePositionSize(entryPrice, stopLossPrice, capitalUSD, riskPercent) {
  const riskAmountUSD = capitalUSD * (riskPercent / 100);
  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  if (riskPerUnit <= 0) return { positionSizeUnits: 0, notionalUSD: 0, riskAmountUSD: 0 };
  const positionSizeUnits = riskAmountUSD / riskPerUnit;
  const notionalUSD = positionSizeUnits * entryPrice;
  return { positionSizeUnits, notionalUSD, riskAmountUSD };
}

function applySlippage(price, direction, side = 'entry') {
  if (config.PAPER_EXECUTION_ENABLED) {
    // Use the same deterministic paper execution model for tracker/manual exits.
    const effectiveDirection = side === 'exit'
      ? (direction === 'LONG' ? 'SHORT' : 'LONG')
      : direction;
    return executionSimulator.estimateFillPrice({
      side: effectiveDirection === 'SHORT' ? 'SELL' : 'BUY',
      referencePrice: price,
      quantity: 0
    });
  }
  const factor = side === 'entry'
    ? (direction === 'LONG' ? 1 + config.SLIPPAGE_PERCENT / 100 : 1 - config.SLIPPAGE_PERCENT / 100)
    : (direction === 'LONG' ? 1 - config.SLIPPAGE_PERCENT / 100 : 1 + config.SLIPPAGE_PERCENT / 100);
  return price * factor;
}

function applyFees(notional) {
  return executionParity.fee(notional, 'taker');
}

function getFuturesSymbol(spotSymbol) {
  const parts = spotSymbol.split('-');
  if (parts.length !== 2) return null;
  let base = parts[0];
  if (base === 'BTC') base = 'XBT';
  return `${base}USDTM`;
}

// ==========================================
// 10. INDIKATOREN & HURST-EXPONENT
// ==========================================
// Punkt 11 - Dynamisches Scoring-System: die Gewichtung der Indikatoren war
// bisher statisch, obwohl unterschiedliche Marktphasen unterschiedliche
// Anforderungen haben. In TRENDING-Märkten zählen ADX und MACD (klassische
// Trendfolge-Indikatoren) stärker, in RANGING-Märkten RSI und relatives
// Volumen (Reversion/Liquidität an Extremen). VOLATILE nutzt eine
// ausgewogene Zwischenstufe. Alle Sets summieren sich auf 100 Punkte.
const SIGNAL_SCORE_WEIGHTS = {
  TRENDING: { adx: 35, rsi: 15, volume: 15, trend1h: 12, trend4h: 13, macd: 10 },
  RANGING:  { adx: 15, rsi: 30, volume: 30, trend1h: 10, trend4h: 10, macd: 5 },
  VOLATILE: { adx: 25, rsi: 22, volume: 18, trend1h: 12, trend4h: 13, macd: 10 }
};
// Fallback, falls marketPhase unbekannt/nicht übergeben ist - identisch zur
// bisherigen statischen Gewichtung (ohne MACD-Anteil).
const DEFAULT_SIGNAL_SCORE_WEIGHTS = { adx: 30, rsi: 20, volume: 20, trend1h: 15, trend4h: 15, macd: 0 };

function calculateSignalScore(params) {
  const weights = SIGNAL_SCORE_WEIGHTS[params.marketPhase] || DEFAULT_SIGNAL_SCORE_WEIGHTS;
  let score = 0;
  score += Math.min(params.adx / 50, 1) * weights.adx;
  const rsiOptimal = params.direction === 'LONG' ? 55 : 45;
  score += Math.max(0, (1 - Math.abs(params.rsi - rsiOptimal) / 30)) * weights.rsi;
  score += Math.min(params.relativeVolume / 2, 1) * weights.volume;
  if (params.trend1h === (params.direction === 'LONG' ? 'BULLISH' : 'BEARISH')) score += weights.trend1h;
  if (params.trend4h === (params.direction === 'LONG' ? 'BULLISH' : 'BEARISH')) score += weights.trend4h;
  if (weights.macd && params.macdHistogram != null) {
    const macdAligned = params.direction === 'LONG' ? params.macdHistogram >= 0 : params.macdHistogram <= 0;
    if (macdAligned) score += weights.macd;
  }
  return Math.round(Math.min(score, 100));
}

// ==========================================
// 11. EXCHANGE ADAPTER / KUCOIN MARKET DATA
// ==========================================
// The adapter is the single exchange boundary. Execution is intentionally
// disabled because this project is signal-only/paper-trading.
const exchangeAdapter = new KuCoinFuturesAdapter({
  logger,
  request: axiosGetWithRetry,
  futuresRequest: futuresApiGetWithRetry,
  getFuturesSymbol,
  parseFloatSafe: safeParseFloat,
  config
});

logger.info(`🔌 Exchange Adapter: ${exchangeAdapter.name} | Execution: DISABLED | MarketData: ENABLED`);

const executionSimulator = new ExecutionSimulator({ config, logger });
const executionParity = new ExecutionParity({ config, simulator: executionSimulator });
const riskEngine = new RiskEngine({ config, logger });
const paperExecutionIdempotency = new ExecutionIdempotency({
  collection: null,
  logger,
  ttlMs: 7 * 24 * 3600 * 1000
});
const paperExecutionAdapter = new PaperExecutionAdapter({
  simulator: executionSimulator,
  idempotency: paperExecutionIdempotency,
  collection: null,
  logger
});
let reconciliationEngine = new ReconciliationEngine({
  getBotTrades: () => activeTrades,
  executionAdapter: paperExecutionAdapter,
  logger
});

logger.info('🧪 Phase-B Execution aktiv | PaperOnly + Idempotency + Reconciliation + Fee/Spread/Slippage/Latency');

// ==========================================
// 11. KUCOIN MARKET DATA
// ==========================================
const FUTURES_GRANULARITY_MINUTES = { '1d': 1440, '4h': 240, '1h': 60, '15m': 15, '5m': 5, '1m': 1 };

async function fetchKucoinKlines(symbol, timeframe = '15m', limit = 100) {
  try { return await exchangeAdapter.getKlines(symbol, timeframe, limit); }
  catch (e) { logger.warn(`[ExchangeAdapter] Klines ${symbol}/${timeframe}: ${e.message}`); return null; }
}

const ONE_HOUR_MS = 3600000, FOUR_HOUR_MS = 14400000;

function deriveHigherTimeframes(candles15m, targetTimeframe) {
  if (!candles15m || candles15m.length < 4) return null;
  const periods = { '1h': 4, '4h': 16, '1d': 96 };
  const period = periods[targetTimeframe];
  if (!period) return null;

  const derived = [];
  for (let i = period - 1; i < candles15m.length; i += period) {
    const slice = candles15m.slice(i - period + 1, i + 1);
    // Bug fixed: this timestamp used to be the LAST constituent candle's
    // time. That made every derived HTF candle look "closed" even while it
    // was still forming, and was inconsistent with backtest-engine.js's
    // aggregate(), which already stamps the OPEN time of the first
    // constituent 15m bar. Using the open time here keeps live and backtest
    // HTF timestamps consistent and lets callers correctly test candle
    // closure via `htf.time + timeframeMs <= now`.
    derived.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((sum, c) => sum + c.volume, 0)
    });
  }
  return derived;
}

async function fetchKucoinTickerPrice(symbol) {
  try { return await exchangeAdapter.getTicker(symbol); }
  catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); return null; }
}

async function fetchKucoinMarkPrice(symbol) {
  try { return await exchangeAdapter.getMarkPrice(symbol); }
  catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); return null; }
}

async function fetchFuturesData(symbol) {
  try { return await exchangeAdapter.getContract(symbol); }
  catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); return null; }
}

async function fetchOrderBookMetrics(symbol) {
  // Step 4: strategy may consume only a locally validated, fresh L2 book.
  // A REST snapshot is retained as a compatibility fallback, but is explicitly
  // marked non-WS and cannot clear a WS gap/invalid state.
  try {
    if (orderBookEngine && orderBookEngine.isTradable(symbol)) {
      return orderBookEngine.metrics(symbol);
    }
    // Once a sequenced L2 stream has declared a gap, REST must not silently
    // clear the pause. Recovery requires a validated snapshot/replay.
    if (orderBookEngine && orderBookEngine.isPaused(symbol)) return null;

    const book = await exchangeAdapter.getOrderBook(symbol);
    if (!book) return null;
    const spreadPct = Number(book.spreadPct);
    const valid = Number.isFinite(spreadPct) && Number(book.bestBid) > 0 && Number(book.bestAsk) >= Number(book.bestBid);
    if (!valid) return null;

    // Compatibility path: REST snapshots have no validated sequence, therefore
    // they are never installed into the sequenced local L2 book.
    if (String(process.env.MARKET_DATA_REQUIRE_WS || 'false').toLowerCase() === 'true') return null;
    return {
      ...book,
      spreadPct,
      bidAskRatio: Number.isFinite(Number(book.bidAskRatio)) ? Number(book.bidAskRatio) : null,
      fetchedAt: Date.now(),
      valid: true,
      fresh: true,
      source: 'rest_snapshot_unsequenced',
      sequenceValidated: false,
      tradingPaused: false
    };
  } catch (e) {
    return null;
  }
}

const contractSpecsCache = new Map();

async function loadFuturesContractSpecs() {
  try {
    const contracts = await exchangeAdapter.getActiveContracts();
    contractSpecsCache.clear();
    for (const c of contracts) {
      if (!c.symbol || c.status !== 'Open') continue;
      const multiplier = safeParseFloat(c.multiplier, 'multiplier', c.symbol);
      const lotSize = safeParseFloat(c.lotSize, 'lotSize', c.symbol);
      if (multiplier === null || lotSize === null || multiplier <= 0 || lotSize <= 0) continue;
      contractSpecsCache.set(c.symbol, {
        multiplier, lotSize,
        maxOrderQty: safeParseFloat(c.maxOrderQty, 'maxOrderQty', c.symbol) || Infinity,
        status: c.status
      });
    }
    logger.info(`📦 ${contractSpecsCache.size} offene Futures-Kontrakte geladen`);
  } catch (e) { logger.warn(`[ExchangeAdapter] Contract specs: ${e.message}`); }
}

function isFuturesContractTradable(spotSymbol) {
  const futuresSymbol = getFuturesSymbol(spotSymbol);
  if (!futuresSymbol) return false;
  return contractSpecsCache.has(futuresSymbol);
}

function roundToContractSize(rawUnits, spotSymbol) {
  const futuresSymbol = getFuturesSymbol(spotSymbol);
  const spec = futuresSymbol ? contractSpecsCache.get(futuresSymbol) : null;
  if (!spec) return null;

  const rawContracts = rawUnits / spec.multiplier;
  const contracts = Math.floor(rawContracts / spec.lotSize) * spec.lotSize;
  if (contracts <= 0) return null;

  if (contracts > spec.maxOrderQty) {
    return { contracts: spec.maxOrderQty, positionSizeUnits: spec.maxOrderQty * spec.multiplier, cappedByMaxOrderQty: true };
  }
  return { contracts, positionSizeUnits: contracts * spec.multiplier };
}

async function getTopKucoinPairs(limit = 100) {
  try {
    const pairs = await exchangeAdapter.getTopSpotPairs(limit);
    return pairs.length ? pairs : ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT'];
  } catch (e) {
    return ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT'];
  }
}

// ==========================================
// 12. CACHING & PRELOADING
// ==========================================
const klinesCache = new LRUCache(config.MAX_KLINES_CACHE_SIZE);
const preloadQueue = [];
let isPreloading = false;

async function preloadKlines(symbols, timeframe, limit) {
  if (!config.ENABLE_PRELOADING) return;
  const uncached = symbols.filter(s => !klinesCache.has(`${s}_${timeframe}`));
  if (uncached.length === 0) return;
  for (const symbol of uncached) preloadQueue.push({ symbol, timeframe, limit });
  if (!isPreloading) processPreloadQueue();
}

async function processPreloadQueue() {
  if (isPreloading || preloadQueue.length === 0) return;
  isPreloading = true;
  while (preloadQueue.length > 0) {
    const { symbol, timeframe, limit } = preloadQueue.shift();
    try { await fetchKucoinKlinesCached(symbol, timeframe, limit); } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); }
    await sleep(50);
  }
  isPreloading = false;
}

async function fetchKucoinKlinesCached(symbol, timeframe, limit) {
  const now = Date.now();
  const cacheKey = `${symbol}_${timeframe}`;
  const cached = klinesCache.get(cacheKey);
  if (cached && cached.timeframe === timeframe && (now - cached.timestamp) < 55000) {
    return cached.candles;
  }
  const candles = await fetchKucoinKlines(symbol, timeframe, limit);
  if (candles) {
    klinesCache.set(cacheKey, { candles, timeframe, timestamp: now });
  }
  return candles;
}

// ==========================================
// CENTRAL MARKET-DATA GATEWAY
// ==========================================
// One bounded request bundle per symbol. Duplicate in-flight requests are
// coalesced and the KuCoin circuit breaker is checked before fan-out.
// The semaphore is deliberately separate from the general scan pool: a scan
// worker may perform several exchange requests, so limiting only workers is
// not enough to control exchange-side fan-out.
const marketDataInflight = new Map();
const marketDataSemaphore = {
  active: 0,
  queue: [],
  limit: Math.max(1, Number(config.MARKET_DATA_CONCURRENCY || 3)),
  async acquire(timeoutMs = 10000) {
    if (this.active < this.limit) {
      this.active++;
      return true;
    }
    let timer;
    let resolver;
    const waiter = new Promise(resolve => { resolver = resolve; });
    this.queue.push(resolver);
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const granted = await Promise.race([waiter.then(() => true), timeout]);
    clearTimeout(timer);
    if (!granted) {
      const idx = this.queue.indexOf(resolver);
      if (idx !== -1) this.queue.splice(idx, 1);
      return false;
    }
    this.active++;
    return true;
  },
  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
};
const MARKET_DATA_BUNDLE_TIMEOUT_MS = Math.min(
  Math.max(parseInt(process.env.MARKET_DATA_BUNDLE_TIMEOUT_MS, 10) || 20000, 5000),
  Math.max(5000, config.SCAN_ITEM_TIMEOUT_MS - 1000)
);

function isKucoinCircuitOpen() {
  return Date.now() < kucoinCircuitOpenUntil;
}

async function getMarketDataBundle(symbol) {
  if (isKucoinCircuitOpen()) {
    const err = new Error('KuCoin Circuit Breaker aktiv (API-Schutz)');
    err.code = 'KUCOIN_CIRCUIT_OPEN';
    throw err;
  }

  const key = `bundle:${symbol}`;
  const existing = marketDataInflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const acquired = await marketDataSemaphore.acquire(10000);
    if (!acquired) {
      const err = new Error(`${symbol} market-data concurrency queue timeout after 10000ms`);
      err.code = 'MARKET_DATA_QUEUE_TIMEOUT';
      throw err;
    }
    try {
      const raw15m = await fetchKucoinKlinesCached(symbol, '15m', 100);
    if (!raw15m || raw15m.length < 20) {
      const err = new Error(`${symbol}/15m market data unavailable`);
      err.code = 'KLINES_UNAVAILABLE';
      throw err;
    }

    let raw1h = config.ENABLE_MULTI_TF_DERIVATION
      ? deriveHigherTimeframes(raw15m, '1h')
      : await fetchKucoinKlinesCached(symbol, '1h', 50);
    if (!raw1h) {
      const err = new Error(`${symbol}/1h market data unavailable`);
      err.code = 'KLINES_UNAVAILABLE';
      throw err;
    }
    raw1h = raw1h.filter(c => c.time + ONE_HOUR_MS <= Date.now());
    if (raw1h.length === 0) {
      const err = new Error(`${symbol}/1h closed candles unavailable`);
      err.code = 'KLINES_UNAVAILABLE';
      throw err;
    }

    let raw4h = null;
    if (config.REQUIRE_4H_TREND) {
      raw4h = config.ENABLE_MULTI_TF_DERIVATION
        ? deriveHigherTimeframes(raw15m, '4h')
        : await fetchKucoinKlinesCached(symbol, '4h', 50);
      if (raw4h) raw4h = raw4h.filter(c => c.time + FOUR_HOUR_MS <= Date.now());
    }

    // Independent optional sources run concurrently. A failed optional source
    // is handled by the existing strategy gate instead of blocking the bundle.
    const [futuresResult, orderBookResult] = await Promise.allSettled([
      fetchFuturesData(symbol),
      fetchOrderBookMetrics(symbol)
    ]);

      return {
        symbol, raw15m, raw1h, raw4h,
        futuresData: futuresResult.status === 'fulfilled' ? futuresResult.value : null,
        orderBookMetrics: orderBookResult.status === 'fulfilled' ? orderBookResult.value : null,
        fetchedAt: Date.now()
      };
    } finally {
      marketDataSemaphore.release();
    }
  })();

  marketDataInflight.set(key, task);
  try {
    return await task;
  } finally {
    marketDataInflight.delete(key);
  }
}

// ==========================================
// 13. MARKT-REGIME & KELLY SIZING
// ==========================================
function detectMarketPhase(btcTrend, btcADX, btcVolatility) {
  if (btcADX > 25 && btcVolatility > 0.03) return 'TRENDING';
  if (btcADX < 20 && btcVolatility < 0.015) return 'RANGING';
  return 'VOLATILE';
}

function getAdaptiveConfig(marketPhase) {
  const configs = {
    'TRENDING': { ADX_MIN_MULT: 1.0, ATR_STOP_MULT_ADJ: 0, TP1_MULT_ADJ: 0, VOLUME_MULT: 1.0 },
    'RANGING':  { ADX_MIN_MULT: 1.3, ATR_STOP_MULT_ADJ: -0.3, TP1_MULT_ADJ: -0.2, VOLUME_MULT: 0.9 },
    'VOLATILE': { ADX_MIN_MULT: 0.9, ATR_STOP_MULT_ADJ: 0.3, TP1_MULT_ADJ: 0.2, VOLUME_MULT: 1.2 }
  };
  return configs[marketPhase] || configs['RANGING'];
}

function calculateKellyRisk(winRate, avgWin, avgLoss, maxRiskPercent) {
  if (avgLoss === 0 || winRate === 0) return maxRiskPercent / 100;
  const winProb = winRate / 100;
  const ratio = avgWin / Math.abs(avgLoss);
  const kelly = (winProb * ratio - (1 - winProb)) / ratio;
  return Math.max(0.001, Math.min(kelly * 0.5, maxRiskPercent / 100));
}

// ==========================================
// 14. STATISTIK & REPORTS
// ==========================================
function formatPeriodPerformanceReport(stats, periodLabel, startDate, endDate) {
  if (!stats || stats.totalTrades === 0) {
    return `📊 <b>${periodLabel} (${startDate} - ${endDate})</b>\n• Keine abgeschlossenen Trades in diesem Zeitraum.\n• Aktive Trades: ${activeTrades.size}\n• Heutige PnL: $${dailyNetPnL.toFixed(2)}`;
  }
  const emoji = stats.netPnL >= 0 ? '🟢' : '🔴';
  let report = `📊 <b>${periodLabel} (${startDate} - ${endDate})</b>\n\n`;
  report += `${emoji} <b>Netto PnL: $${stats.netPnL.toFixed(2)}</b>\n━━━━━━━━━━━━━━━━━━\n`;
  report += `• Abgeschlossene Trades: ${stats.totalTrades}\n`;
  report += `• Teilverkäufe (TP1): ${stats.tp1Count}\n`;
  report += `• Volltreffer (TP2): ${stats.tp2Count}\n`;
  report += `• Stop-Loss: ${stats.slCount}\n`;
  report += `• Trailing-Stops: ${stats.trailingStopCount}\n`;
  report += `• Time-Stops: ${stats.timeStopCount}\n`;
  report += `• Absolute Zeitlimits: ${stats.absoluteTimeLimitCount}\n\n`;
  report += `<b>Performance-Kennzahlen:</b>\n`;
  report += `• Gewinner: ${stats.winnersCount} | Verlierer: ${stats.losersCount}\n`;
  report += `• Win-Rate: ${stats.winRate}%\n`;
  report += `• Ø Gewinn: $${stats.avgWin.toFixed(2)}\n`;
  report += `• Ø Verlust: $${Math.abs(stats.avgLoss).toFixed(2)}\n`;
  report += `• Profit-Faktor: ${stats.profitFactor}\n`;
  report += `• Sharpe Ratio: ${stats.sharpeRatio}\n`;
  report += `• Ø PnL/Trade: $${(stats.netPnL / stats.totalTrades).toFixed(2)}\n`;
  if (stats.bestTrade) report += `• Bester Trade: $${stats.bestTrade.toFixed(2)}\n`;
  if (stats.worstTrade) report += `• Schlechtester Trade: $${stats.worstTrade.toFixed(2)}\n`;
  return report;
}

async function getPeriodNetPnL(daysBack) {
  if (!closedTradesCollection || !isDbConnected) return 0;
  try {
    const since = Date.now() - Number(daysBack) * 86400000;
    const rows = await closedTradesCollection.find({ closeTime: { $gte: since } }, { projection: { pnlUSD: 1 } }).toArray();
    return rows.reduce((sum, t) => sum + (Number(t.pnlUSD) || 0), 0);
  } catch (e) { logger.warn?.(`[RISK] Period-PnL read failed: ${e.message}`); return 0; }
}

async function getPeriodPerformanceStats(daysBack) {
  if (daysBack <= 0) daysBack = 7;
  try {
    if (!closedTradesCollection || !isDbConnected) return null;
    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const trades = await closedTradesCollection.find({ closeTime: { $gte: startDate.getTime(), $lte: now.getTime() } }).toArray();

    if (trades.length === 0) {
      return { totalTrades: 0, netPnL: 0, totalProfit: 0, totalLoss: 0, winRate: '0.0', avgWin: 0, avgLoss: 0, winnersCount: 0, losersCount: 0, tp1Count: 0, tp2Count: 0, slCount: 0, timeStopCount: 0, absoluteTimeLimitCount: 0, trailingStopCount: 0, profitFactor: 'N/A', bestTrade: null, worstTrade: null, sharpeRatio: '0.00', startDate: startDate.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10) };
    }

    const totalPnL = trades.reduce((sum, t) => sum + (t.pnlUSD || 0), 0);
    const fullCloses = trades.filter(t => !t.isPartial);
    const winners = fullCloses.filter(t => (t.pnlUSD || 0) > 0);
    const losers = fullCloses.filter(t => (t.pnlUSD || 0) <= 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnlUSD, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.pnlUSD, 0) / losers.length : 0;
    const winRate = fullCloses.length > 0 ? (winners.length / fullCloses.length * 100).toFixed(1) : '0';

    const totalProfit = winners.reduce((sum, t) => sum + t.pnlUSD, 0);
    const totalLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnlUSD, 0));
    const profitFactor = totalLoss > 0 ? (totalProfit / totalLoss).toFixed(2) : (totalProfit > 0 ? '∞' : '0.00');

    const sortedByPnL = fullCloses.sort((a, b) => b.pnlUSD - a.pnlUSD);
    const bestTrade = sortedByPnL.length > 0 ? sortedByPnL[0].pnlUSD : null;
    const worstTrade = sortedByPnL.length > 0 ? sortedByPnL[sortedByPnL.length - 1].pnlUSD : null;

    const reasonCounts = {};
    trades.forEach(t => {
      const reason = t.closeReason || 'unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    const dailyPnLs = [];
    let currentDay = '', dayPnL = 0;
    for (const t of trades) {
      const day = new Date(t.closeTime).toISOString().slice(0, 10);
      if (day !== currentDay) {
        if (currentDay) dailyPnLs.push(dayPnL / config.CAPITAL_USD);
        currentDay = day; dayPnL = t.pnlUSD || 0;
      } else dayPnL += (t.pnlUSD || 0);
    }
    if (currentDay) dailyPnLs.push(dayPnL / config.CAPITAL_USD);

    return {
      totalTrades: fullCloses.length, netPnL: totalPnL, totalProfit, totalLoss: -totalLoss,
      winRate, avgWin, avgLoss, winnersCount: winners.length, losersCount: losers.length,
      tp1Count: reasonCounts['tp1-partial'] || 0, tp2Count: reasonCounts['tp2'] || 0, slCount: reasonCounts['stop-loss'] || 0,
      timeStopCount: reasonCounts['time-stop'] || 0, absoluteTimeLimitCount: reasonCounts['absolute-time-limit'] || 0,
      trailingStopCount: reasonCounts['trailing-stop'] || 0, profitFactor, bestTrade, worstTrade,
      sharpeRatio: calculateSharpeRatio(dailyPnLs).toFixed(2),
      startDate: startDate.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10)
    };
  } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); return null; }
}

async function getTimeBasedAnalysis() {
  try {
    if (!closedTradesCollection || !isDbConnected) return null;
    const trades = await closedTradesCollection.find({ closeTime: { $gte: Date.now() - 30 * 86400000 } }).toArray();
    const hourlyStats = {}, dailyStats = {};
    trades.forEach(t => {
      const d = new Date(t.closeTime);
      const h = d.getUTCHours(), dy = d.getUTCDay(), pnl = t.pnlUSD || 0;
      if (!hourlyStats[h]) hourlyStats[h] = { trades: 0, pnl: 0, wins: 0 };
      hourlyStats[h].trades++; hourlyStats[h].pnl += pnl; if (pnl > 0) hourlyStats[h].wins++;
      if (!dailyStats[dy]) dailyStats[dy] = { trades: 0, pnl: 0, wins: 0 };
      dailyStats[dy].trades++; dailyStats[dy].pnl += pnl; if (pnl > 0) dailyStats[dy].wins++;
    });
    return { hourlyStats, dailyStats };
  } catch (e) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${e.message}`); return null; }
}

async function checkRiskLevels() {
  if (!config.RISK_WARNING_ENABLED || !isDbConnected || !closedTradesCollection) return;
  const weekStats = await getPeriodPerformanceStats(7);
  if (weekStats && weekStats.totalTrades > 0 && weekStats.netPnL < 0) {
    const drawdownPercent = (Math.abs(weekStats.netPnL) / config.CAPITAL_USD) * 100;
    if (drawdownPercent > config.MAX_WEEKLY_DRAWDOWN_PERCENT) {
      await sendDeduplicatedAlert('risk_warning', `🔴 <b>RISIKO-WARNUNG:</b> ${drawdownPercent.toFixed(1)}% Wochen-Drawdown`);
    }
  }
}

function formatScanStatsReport(stats) {
  const lines = [`🔎 <b>SCAN-DIAGNOSE v25.0.9 (${escapeHtml(STRATEGY_PROFILE_NAME)})</b>`];
  lines.push(`Coins geprüft: ${stats.total} | Signale gesendet: ${stats.signalsSent}`);
  if (stats.avgSignalScore !== undefined) lines.push(`Ø Signal-Score: ${stats.avgSignalScore}/100`);
  lines.push(`Marktphase: ${currentMarketPhase}`);
  lines.push(`<b>Pipeline:</b> geladen ${stats.universeLoaded || 0} → Watchlist ${stats.watchlistReturned || 0} → tradable ${stats.tradableCandidates || 0} → Kandidaten ${stats.total || 0} → Indikatoren ${stats.marketDataEvaluated || 0} → Gate PASS ${stats.gatePassed || 0} → finale Signale ${stats.signalsSent || 0}`);
  if (stats.filteredNonTradable || stats.runtimeErrors) {
    lines.push(`Vorfilter: nicht handelbar ${stats.filteredNonTradable || 0} | Runtime-Fehler ${stats.runtimeErrors || 0}`);
  }
  lines.push('');

  const trendTotal = (stats.trendMismatch1h || 0) + (stats.trendMismatch4h || 0) + (stats.trendMismatch || 0);
  if (trendTotal > 0) {
    lines.push(`<b>Trend-Filter (${trendTotal}):</b>`);
    if (stats.trendMismatch1h) lines.push(`  • 1h Trend: ${stats.trendMismatch1h}`);
    if (stats.trendMismatch4h) lines.push(`  • 4h Trend: ${stats.trendMismatch4h}`);
    lines.push('');
  }

  const reasons = [];
  if (stats.missingKlines) reasons.push(`Fehlende/Zu wenige Kerzen (missingKlines): ${stats.missingKlines}`);
  if (stats.skippedActiveTrade) reasons.push(`Offener Trade: ${stats.skippedActiveTrade}`);
  if (stats.skippedMaxSignals) reasons.push(`Max. Signale: ${stats.skippedMaxSignals}`);
  if (stats.skippedDynamicBlacklist) reasons.push(`KI-Erfahrung (Loss-Blocker): ${stats.skippedDynamicBlacklist}`);
  if (stats.timeBlocked) reasons.push(`Time-Learning Filter (ungünstige Stunde/Tag): ${stats.timeBlocked}`);
  if (stats.newsBlackout) reasons.push(`News-Blackout (Makro-Event): ${stats.newsBlackout}`);
  if (stats.mlBlocked) reasons.push(`TensorFlow.js ML-Filter blockiert: ${stats.mlBlocked}`);
  if (stats.dqnBlocked) reasons.push(`DQN Agent (Reinforcement Learning) blockiert: ${stats.dqnBlocked}`);
  if (stats.trendQualityLow) reasons.push(`Trend Quality Score (ADX/Hurst/Chop) zu niedrig: ${stats.trendQualityLow}`);
  if (stats.noBOS) reasons.push(`Kein BOS: ${stats.noBOS}`);
  if (stats.rsiTooLow) reasons.push(`RSI zu niedrig: ${stats.rsiTooLow}`);
  if (stats.rsiTooHigh) reasons.push(`RSI zu hoch: ${stats.rsiTooHigh}`);
  if (stats.pocVwapFail) reasons.push(`POC/VWAP nicht erfüllt: ${stats.pocVwapFail}`);
  if (stats.macdFail) reasons.push(`MACD unpassend: ${stats.macdFail}`);
  if (stats.fundingBlocked) reasons.push(`Funding-Rate blockiert: ${stats.fundingBlocked}`);
  if (stats.relVolTooLow) reasons.push(`Volumen zu niedrig: ${stats.relVolTooLow}`);
  if (stats.correlationBlocked) reasons.push(`Korrelations-Limit: ${stats.correlationBlocked}`);
  if (stats.orderBookBlocked) reasons.push(`Orderbuch Imbalance: ${stats.orderBookBlocked}`);
  if (stats.orderFlowBlocked) reasons.push(`Order Flow / CVD blockiert: ${stats.orderFlowBlocked}`);
  if (stats.spreadTooHigh) reasons.push(`Orderbuch Spread zu hoch: ${stats.spreadTooHigh}`);
  if (stats.cooldownActive) reasons.push(`Signal-Cooldown aktiv: ${stats.cooldownActive}`);
  if (stats.positionTooSmallForLot) reasons.push(`Position zu klein für Min-Lot: ${stats.positionTooSmallForLot}`);
  if (stats.agentBlocked) reasons.push(`Agent Supervisor: ${stats.agentBlocked}`);
  if (stats.riskEngineBlocked) reasons.push(`Risk Engine: ${stats.riskEngineBlocked}`);
  if (stats.reconciliationBlocked) reasons.push(`Reconciliation Gate: ${stats.reconciliationBlocked}`);
  if (stats.paperExecutionRejected) reasons.push(`Paper Execution abgelehnt: ${stats.paperExecutionRejected}`);
  if (stats.lowConfluenceScore) reasons.push(`Confluence Score unter Minimum: ${stats.lowConfluenceScore}`);

  if (reasons.length > 0) {
    lines.push(`<b>Ausschlussgründe:</b>`);
    reasons.forEach(r => lines.push(`• ${r}`));
  }

  return lines.join('\n');
}

async function getDailyPerformanceStats() {
  const todayStr = todayUTCString();
  const todayStart = new Date(todayStr + 'T00:00:00.000Z').getTime();
  const todayEnd = new Date(todayStr + 'T23:59:59.999Z').getTime();
  try {
    if (!closedTradesCollection || !isDbConnected) {
      return { totalTrades: 0, netPnL: dailyNetPnL, totalProfit: 0, totalLoss: 0, winRate: '0.0', avgWin: 0, avgLoss: 0, winnersCount: 0, losersCount: 0, tp1Count: 0, tp2Count: 0, slCount: 0, timeStopCount: 0, absoluteTimeLimitCount: 0, trailingStopCount: 0 };
    }
    const trades = await closedTradesCollection.find({ closeTime: { $gte: todayStart, $lte: todayEnd } }).toArray();
    const closedPnL = trades.reduce((sum, t) => sum + (t.pnlUSD || 0), 0);
    const totalPnL = closedPnL + dailyNetPnL;

    const fullCloses = trades.filter(t => !t.isPartial);
    const winners = fullCloses.filter(t => (t.pnlUSD || 0) > 0);
    const losers = fullCloses.filter(t => (t.pnlUSD || 0) <= 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnlUSD, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.pnlUSD, 0) / losers.length : 0;
    const winRate = fullCloses.length > 0 ? (winners.length / fullCloses.length * 100).toFixed(1) : '0';

    const reasonCounts = {};
    trades.forEach(t => {
      const reason = t.closeReason || 'unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });

    return {
      totalTrades: fullCloses.length, netPnL: totalPnL, totalProfit: winners.reduce((s, t) => s + t.pnlUSD, 0),
      totalLoss: losers.reduce((s, t) => s + t.pnlUSD, 0), winRate, avgWin, avgLoss, winnersCount: winners.length, losersCount: losers.length,
      tp1Count: reasonCounts['tp1-partial'] || 0, tp2Count: reasonCounts['tp2'] || 0, slCount: reasonCounts['stop-loss'] || 0,
      timeStopCount: reasonCounts['time-stop'] || 0, absoluteTimeLimitCount: reasonCounts['absolute-time-limit'] || 0, trailingStopCount: reasonCounts['trailing-stop'] || 0,
    };
  } catch (e) {
    return { totalTrades: 0, netPnL: dailyNetPnL, totalProfit: 0, totalLoss: 0, winRate: '0.0', avgWin: 0, avgLoss: 0, winnersCount: 0, losersCount: 0, tp1Count: 0, tp2Count: 0, slCount: 0, timeStopCount: 0, absoluteTimeLimitCount: 0, trailingStopCount: 0 };
  }
}

// ==========================================
// 15. TRACKER SCHLEIFE & CROSS-HEDGING
// ==========================================
async function fetchMarkPricesBatched(symbols) {
  const priceMap = new Map();
  for (let i = 0; i < symbols.length; i += config.TICKER_BATCH_SIZE) {
    const batch = symbols.slice(i, i + config.TICKER_BATCH_SIZE);
    const results = await Promise.all(batch.map(async symbol => {
      let price = await fetchKucoinMarkPrice(symbol);
      if (price === null) price = await fetchKucoinTickerPrice(symbol);
      return [symbol, price];
    }));
    results.forEach(([symbol, price]) => { if (price !== null) priceMap.set(symbol, price); });
    if (i + config.TICKER_BATCH_SIZE < symbols.length) await sleep(100);
  }
  return priceMap;
}

async function accrueFundingCost(symbol, trade, hoursElapsed) {
  const currentFundingPeriod = Math.floor(hoursElapsed / config.FUNDING_INTERVAL_HOURS);
  if (currentFundingPeriod <= (trade.lastFundingPeriod || 0)) return;
  const futuresData = await fetchFuturesData(symbol);
  if (!futuresData) return;
  const rate = futuresData.fundingRate;
  const fundingCost = trade.direction === 'LONG' ? rate * trade.notionalUSD : -rate * trade.notionalUSD;
  trade.fundingCostUSD = (trade.fundingCostUSD || 0) + fundingCost;
  trade.lastFundingPeriod = currentFundingPeriod;
  await upsertTrade(symbol, trade);
}

// Punkt 7 - Race Condition im Tracker-Lock: trackerLock wird jetzt
// ausschließlich über try/finally zurückgesetzt, sodass ein geworfener Fehler
// (oder ein früher return im try-Block) den Lock niemals dauerhaft blockieren
// kann. Der separate trackerTimeout-Watchdog entfällt dadurch - er war nur
// nötig, weil der alte Code den Lock im Fehlerfall nicht zuverlässig gelöst hat.
async function checkActiveTrades() {
  if (trackerLock) {
    return;
  }
  trackerLock = true;

  try {
    lastTrackerCheckTime = Date.now();

    const btcMark = await fetchKucoinMarkPrice('BTC-USDT') || await fetchKucoinTickerPrice('BTC-USDT');
    if (btcMark && activeTrades.size > 0) {
      const hedgeEvaluation = await hedgeManager.evaluateHedgeNeed(activeTrades, btcMark);
      if (hedgeEvaluation.shouldHedge) {
        await sendDeduplicatedAlert(
          'btc_hedge_flash_crash',
          `🚨 <b>CROSS-HEDGING ALARM!</b>\n` +
          `Bitcoin ist um <b>${hedgeEvaluation.dropPct.toFixed(2)}%</b> eingebrochen.\n` +
          `<i>Empfehlung: Schutz-Short auf BTC öffnen oder Risiko der offenen Longs drosseln!</i>`,
          600000
        );
      }
    }

    if (activeTrades.size === 0) return;

    const symbols = [...activeTrades.keys()];
    const markPrices = await fetchMarkPricesBatched(symbols);

    for (const [symbol, trade] of activeTrades.entries()) {
      try {
        const markPrice = markPrices.get(symbol) ?? null;
        let fallbackClose = null;
        if (markPrice === null) {
          const klines = await fetchKucoinKlinesCached(symbol, '1m', 2);
          if (klines && klines.length > 0) fallbackClose = klines[klines.length - 1].close;
        }
        let currentPrice = markPrice ?? fallbackClose;

        if (currentPrice === null) {
          const failCount = (priceFailureCounts.get(symbol) || 0) + 1;
          priceFailureCounts.set(symbol, failCount);
          if (failCount >= config.MAX_CONSECUTIVE_PRICE_FAILURES) {
            await sendDeduplicatedAlert(`price_warn_${symbol}`, `⚠️ <b>PREISDATEN-WARNUNG: ${escapeHtml(symbol)}</b>`, 1800000);
          }
          continue;
        }
        priceFailureCounts.delete(symbol);

        let highPrice = currentPrice, lowPrice = currentPrice, trailingATR = trade.atrAtEntry;

        if (trade.tp1Hit) {
          const klines1m = await fetchKucoinKlinesCached(symbol, '1m', 20);
          if (klines1m && klines1m.length > 0) {
            highPrice = Math.max(currentPrice, Math.max(...klines1m.map(k => k.high)));
            lowPrice = Math.min(currentPrice, Math.min(...klines1m.map(k => k.low)));
            if (config.DYNAMIC_TRAILING_ATR) {
              const currentATR = calculateATR(klines1m, 14);
              if (currentATR > 0) trailingATR = currentATR;
            }
          }
          if (trade.direction === 'LONG') trade.highestSinceTP1 = Math.max(trade.highestSinceTP1 || trade.entry, highPrice);
          else trade.lowestSinceTP1 = Math.min(trade.lowestSinceTP1 || trade.entry, lowPrice);
          await upsertTrade(symbol, trade);
        }

        const cleanSymbol = escapeHtml(symbol.replace('-USDT', ''));
        const hoursElapsed = (Date.now() - trade.startTime) / 3_600_000;
        const remainingEntryFee = (trade.entryFeeUSD || 0) - (trade.entryFeePaidUSD || 0);

        await accrueFundingCost(symbol, trade, hoursElapsed);
        const fundingCostSoFar = trade.fundingCostUSD || 0;

        if (!trade.tp1Hit && hoursElapsed >= trade.maxHoldHours * 0.75 && !trade.timeStopWarningSent) {
          trade.timeStopWarningSent = true;
          await upsertTrade(symbol, trade);
          await sendTelegramAlert(`⏱️ <b>TIME-STOP WARNUNG: ${cleanSymbol}/USDT</b>`);
        }

        // The absolute hold limit is authoritative for every position.
        if (hoursElapsed >= config.ABSOLUTE_MAX_HOLD_HOURS) {
          const exitPrice = applySlippage(currentPrice, trade.direction, 'exit');
          const pnlPerUnit = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
          const pnlUSD = pnlPerUnit * (trade.positionSizeUnits || 0) - applyFees(trade.notionalUSD) - remainingEntryFee - fundingCostSoFar;
          await recordTradePnL(pnlUSD);
          await sendTelegramAlert(`⌛ <b>ABSOLUTES ZEITLIMIT: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
          try { timesFMShadowJournal.recordClose(symbol, trade, exitPrice, pnlUSD); } catch (journalError) { logger.warn(`[TimesFM Shadow] Journal: ${journalError.message}`); }
          await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'absolute-time-limit', pnlUSD, exitPrice });
          continue;
        }

        if (!trade.tp1Hit && hoursElapsed >= trade.maxHoldHours) {
          const timeStopCandles = await fetchKucoinKlinesCached(symbol, '15m', 80).catch(() => null);
          const timeStopDecision = await dynamicTimeStopAgent.evaluate({
            trade,
            candles: timeStopCandles,
            currentPrice,
            hoursElapsed,
            normalMaxHoldHours: config.MAX_HOLD_HOURS,
            absoluteMaxHoldHours: config.ABSOLUTE_MAX_HOLD_HOURS
          });

          if (timeStopDecision.decision === 'DEFER') {
            trade.timeStopLastDecision = {
              at: Date.now(), decision: 'DEFER', score: 0, extensionHours: 0,
              recommendedHoldHours: Number(trade.maxHoldHours) || config.MAX_HOLD_HOURS,
              reasons: timeStopDecision.reasons
            };
            await upsertTrade(symbol, trade);
            logger.warn(`[DYNAMIC-TIME-STOP] ${symbol}: DEFER wegen fehlender Marktdaten (${timeStopDecision.reasons.join(', ')})`);
            continue;
          }

          if (timeStopDecision.decision === 'EXTEND') {
            const oldMaxHold = Number(trade.maxHoldHours) || config.MAX_HOLD_HOURS;
            const extension = Math.max(0, Math.min(
              Number(timeStopDecision.extensionHours) || 0,
              config.ABSOLUTE_MAX_HOLD_HOURS - oldMaxHold
            ));
            if (extension <= 0) {
              timeStopDecision.decision = 'EXIT';
            } else {
              trade.timeStopExtensionUsedHours = Math.min(
                Number(config.DYNAMIC_TIME_STOP_MAX_EXTENSION_HOURS || 2),
                (Number(trade.timeStopExtensionUsedHours) || 0) + extension
              );
              trade.maxHoldHours = Math.min(config.ABSOLUTE_MAX_HOLD_HOURS, oldMaxHold + extension);
              trade.timeStopLastDecision = {
                at: Date.now(), decision: 'EXTEND', score: timeStopDecision.score,
                extensionHours: extension, extensionUsedHours: trade.timeStopExtensionUsedHours,
                recommendedHoldHours: trade.maxHoldHours, reasons: timeStopDecision.reasons,
                timesFM: timeStopDecision.timesFM || null, decisionPrice: currentPrice
              };
              trade.timeStopDecisionHistory = Array.isArray(trade.timeStopDecisionHistory) ? trade.timeStopDecisionHistory : [];
              trade.timeStopDecisionHistory.push(trade.timeStopLastDecision);
              if (trade.timeStopDecisionHistory.length > 10) trade.timeStopDecisionHistory = trade.timeStopDecisionHistory.slice(-10);
              try { timesFMShadowJournal.recordDecision(symbol, trade, currentPrice, timeStopDecision); } catch (journalError) { logger.warn(`[TimesFM Shadow] Journal: ${journalError.message}`); }
              trade.timeStopWarningSent = false;
              await upsertTrade(symbol, trade);
              logger.info(`[DYNAMIC-TIME-STOP] ${symbol}: HOLD +${extension.toFixed(2)}h -> ${trade.maxHoldHours.toFixed(2)}h used=${trade.timeStopExtensionUsedHours.toFixed(2)}h (${timeStopDecision.reasons.join(', ')})`);
              continue;
            }
          }

          const exitPrice = applySlippage(currentPrice, trade.direction, 'exit');
          const pnlPerUnit = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
          const pnlUSD = pnlPerUnit * (trade.positionSizeUnits || 0) - applyFees(trade.notionalUSD) - remainingEntryFee - fundingCostSoFar;
          await recordTradePnL(pnlUSD);
          await sendTelegramAlert(`⌛ <b>TIME-STOP: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
          try { timesFMShadowJournal.recordClose(symbol, trade, exitPrice, pnlUSD); } catch (journalError) { logger.warn(`[TimesFM Shadow] Journal: ${journalError.message}`); }
          await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'time-stop', pnlUSD, exitPrice });
          continue;
        }

        // Punkt 13 - Break-Even früher aktivieren: bisher wanderte der
        // Stop-Loss erst NACH TP1 auf Break-Even. Jetzt gibt es zusätzlich
        // ein früheres Break-Even-Level bei entry ± (ATR*0.5). Sobald der
        // Preis dieses Level erreicht (auch vor TP1), wird der Stop auf den
        // Entry-Preis plus einen sehr kleinen Trailing-Abstand (0.1 ATR)
        // gesetzt - nicht exakt auf Entry, damit normales Rauschen den Trade
        // nicht sofort wieder ausstoppt.
        if (!trade.tp1Hit && !trade.breakEvenActivated) {
          const beDistance = (trade.atrAtEntry || 0) * 0.5;
          const beTrail = (trade.atrAtEntry || 0) * 0.1;
          if (beDistance > 0) {
            const beLevel = trade.direction === 'LONG' ? trade.entry + beDistance : trade.entry - beDistance;
            const beReached = trade.direction === 'LONG' ? highPrice >= beLevel : lowPrice <= beLevel;
            if (beReached) {
              const newStop = trade.direction === 'LONG' ? trade.entry + beTrail : trade.entry - beTrail;
              const improves = trade.direction === 'LONG' ? newStop > trade.stopLoss : newStop < trade.stopLoss;
              if (improves) {
                trade.stopLoss = newStop;
                trade.breakEvenActivated = true;
                await upsertTrade(symbol, trade);
                await sendTelegramAlert(`🔐 <b>BREAK-EVEN AKTIVIERT: ${cleanSymbol}/USDT</b> SL → $${newStop.toFixed(6)}`);
              }
            }
          }
        }

        if (config.TRAILING_STOP_ENABLED && trade.tp1Hit) {
          const trailDistance = trailingATR * config.TRAILING_ATR_MULT;
          let newStop = null;
          if (trade.direction === 'LONG') {
            const candidateStop = (trade.highestSinceTP1 || highPrice) - trailDistance;
            if (candidateStop > (trade.stopLoss || 0)) newStop = candidateStop;
          } else {
            const candidateStop = (trade.lowestSinceTP1 || lowPrice) + trailDistance;
            if (candidateStop < (trade.stopLoss || Infinity)) newStop = candidateStop;
          }
          if (newStop && newStop !== trade.stopLoss) {
            trade.stopLoss = newStop;
            await upsertTrade(symbol, trade);
          }
        }

        if (trade.direction === 'LONG') {
          // Conservative intrabar policy: if one OHLC bar touches the stop and
          // any target, stop wins. This must match backtest assumptions.
          if (lowPrice <= trade.stopLoss) {
            const exitPrice = applySlippage(trade.stopLoss, 'LONG', 'exit');
            const pnlUSD = (exitPrice - trade.entry) * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - (trade.fundingCostUSD || 0);
            await recordTradePnL(pnlUSD, { symbol, closeTime: Date.now(), closeReason: 'stop-loss-intrabar', feeUSD: applyFees(trade.notionalUSD), fundingUSD: trade.fundingCostUSD || 0 });
            await sendTelegramAlert(`🛑 <b>STOP LOSS (INTRABAR-CONSERVATIVE): ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
            await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'stop-loss', pnlUSD, exitPrice });
            continue;
          }
          if (highPrice >= trade.tp2) {
            const exitPrice = applySlippage(trade.tp2, 'LONG', 'exit');
            const pnlUSD = (exitPrice - trade.entry) * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - fundingCostSoFar;
            await recordTradePnL(pnlUSD);
            await sendTelegramAlert(`🎉 <b>TP2 ERREICHT: ${cleanSymbol}/USDT (LONG)</b> PnL: $${pnlUSD.toFixed(2)}`);
            await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'tp2', pnlUSD, exitPrice });
            continue;
          }

          if (!trade.tp1Hit && highPrice >= trade.tp1) {
            trade.tp1Hit = true;
            const exitPrice = applySlippage(trade.tp1, 'LONG', 'exit');
            const partialUnits = trade.positionSizeUnits * (config.TP1_CLOSE_PERCENT / 100);
            const partialEntryFee = (trade.entryFeeUSD || 0) * (config.TP1_CLOSE_PERCENT / 100);
            const partialFundingCost = fundingCostSoFar * (config.TP1_CLOSE_PERCENT / 100);
            let partialExecution = null;
            if (config.PAPER_EXECUTION_ENABLED) {
              try {
                partialExecution = await executePaperExecutionThroughCore({
                  symbol,
                  direction: trade.direction === 'LONG' ? 'SHORT' : 'LONG',
                  clientOrderId: `partial:${trade.signalId || symbol}:tp1:${Number(partialUnits).toFixed(12)}`,
                  action: 'REDUCE',
                  quantity: partialUnits,
                  referencePrice: trade.tp1,
                  fillPriceOverride: exitPrice,
                  reason: 'tp1-partial',
                  orderBookValid: true,
                  spreadPct: 0,
                  marketDataAgeMs: 0,
                  risk: { allowed: true, reason: 'POSITION_REDUCTION' }
                });
              } catch (e) {
                logger.error(`[PAPER PARTIAL CLOSE] ${symbol}: ${e.message}`);
                reconciliationEngine.healthy = false;
                isPaused = true;
                global.reconciliationHealthy = false;
                return;
              }
            }

            const partialFillPrice = Number(partialExecution?.remote?.avgFillPrice || exitPrice);
            const partialFilledQty = Number(partialExecution?.remote?.filledQty || partialUnits);
            const actualPartialUnits = Math.min(partialUnits, partialFilledQty);
            const partialPnl = (partialFillPrice - trade.entry) * actualPartialUnits - applyFees(trade.notionalUSD * (actualPartialUnits / Math.max(partialUnits, 1e-12))) - partialEntryFee - partialFundingCost;

            trade.positionSizeUnits -= actualPartialUnits;
            trade.partiallyClosed = true;
            trade.notionalUSD = trade.positionSizeUnits * trade.entry;
            trade.entryFeePaidUSD = (trade.entryFeePaidUSD || 0) + partialEntryFee;
            trade.fundingCostUSD = fundingCostSoFar - partialFundingCost;
            trade.stopLoss = trade.entry;
            trade.highestSinceTP1 = partialFillPrice;

            await upsertTrade(symbol, trade);
            await recordTradePnL(partialPnl);
            await persistClosedTradeRecord({ symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'tp1-partial', pnlUSD: partialPnl, exitPrice, isPartial: true });
            await sendTelegramAlert(`🎯 <b>TP1 ERREICHT: ${cleanSymbol}/USDT (LONG)</b> Teil-PnL: $${partialPnl.toFixed(2)}`);
          }

          if (lowPrice <= trade.stopLoss) {
            const exitPrice = applySlippage(trade.stopLoss, 'LONG', 'exit');
            const pnlUSD = (exitPrice - trade.entry) * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - (trade.fundingCostUSD || 0);
            await recordTradePnL(pnlUSD);
            const reason = trade.tp1Hit ? 'trailing-stop' : 'stop-loss';
            await sendTelegramAlert(trade.tp1Hit ? `🔒 <b>TRAILING STOP: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}` : `🛑 <b>STOP LOSS: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
            await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: reason, pnlUSD, exitPrice });
            continue;
          }
        } else if (trade.direction === 'SHORT') {
          // Conservative intrabar policy: stop wins over targets on ambiguous bars.
          if (highPrice >= trade.stopLoss) {
            const exitPrice = applySlippage(trade.stopLoss, 'SHORT', 'exit');
            const pnlUSD = (trade.entry - exitPrice) * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - (trade.fundingCostUSD || 0);
            await recordTradePnL(pnlUSD, { symbol, closeTime: Date.now(), closeReason: 'stop-loss-intrabar', feeUSD: applyFees(trade.notionalUSD), fundingUSD: trade.fundingCostUSD || 0 });
            await sendTelegramAlert(`🛑 <b>STOP LOSS (INTRABAR-CONSERVATIVE): ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
            await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'stop-loss', pnlUSD, exitPrice });
            continue;
          }
          if (lowPrice <= trade.tp2) {
            const exitPrice = applySlippage(trade.tp2, 'SHORT', 'exit');
            const pnlUSD = (trade.entry - exitPrice) * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - fundingCostSoFar;
            await recordTradePnL(pnlUSD);
            await sendTelegramAlert(`🎉 <b>TP2 ERREICHT: ${cleanSymbol}/USDT (SHORT)</b> PnL: $${pnlUSD.toFixed(2)}`);
            await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'tp2', pnlUSD, exitPrice });
            continue;
          }

          if (!trade.tp1Hit && lowPrice <= trade.tp1) {
            trade.tp1Hit = true;
            const exitPrice = applySlippage(trade.tp1, 'SHORT', 'exit');
            const partialUnits = trade.positionSizeUnits * (config.TP1_CLOSE_PERCENT / 100);
            const partialEntryFee = (trade.entryFeeUSD || 0) * (config.TP1_CLOSE_PERCENT / 100);
            const partialFundingCost = fundingCostSoFar * (config.TP1_CLOSE_PERCENT / 100);
            let partialExecution = null;
            if (config.PAPER_EXECUTION_ENABLED) {
              try {
                partialExecution = await executePaperExecutionThroughCore({
                  symbol,
                  direction: trade.direction === 'LONG' ? 'SHORT' : 'LONG',
                  clientOrderId: `partial:${trade.signalId || symbol}:tp1:${Number(partialUnits).toFixed(12)}`,
                  action: 'REDUCE',
                  quantity: partialUnits,
                  referencePrice: trade.tp1,
                  fillPriceOverride: exitPrice,
                  reason: 'tp1-partial',
                  orderBookValid: true,
                  spreadPct: 0,
                  marketDataAgeMs: 0,
                  risk: { allowed: true, reason: 'POSITION_REDUCTION' }
                });
              } catch (e) {
                logger.error(`[PAPER PARTIAL CLOSE] ${symbol}: ${e.message}`);
                reconciliationEngine.healthy = false;
                isPaused = true;
                global.reconciliationHealthy = false;
                return;
              }
            }

            const partialFillPrice = Number(partialExecution?.remote?.avgFillPrice || exitPrice);
            const partialFilledQty = Number(partialExecution?.remote?.filledQty || partialUnits);
            const actualPartialUnits = Math.min(partialUnits, partialFilledQty);
            const partialPnl = (trade.entry - partialFillPrice) * actualPartialUnits - applyFees(trade.notionalUSD * (actualPartialUnits / Math.max(partialUnits, 1e-12))) - partialEntryFee - partialFundingCost;

            trade.positionSizeUnits -= actualPartialUnits;
            trade.partiallyClosed = true;
            trade.notionalUSD = trade.positionSizeUnits * trade.entry;
            trade.entryFeePaidUSD = (trade.entryFeePaidUSD || 0) + partialEntryFee;
            trade.fundingCostUSD = fundingCostSoFar - partialFundingCost;
            trade.stopLoss = trade.entry;
            trade.lowestSinceTP1 = partialFillPrice;

            await upsertTrade(symbol, trade);
            await recordTradePnL(partialPnl);
            await persistClosedTradeRecord({ symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'tp1-partial', pnlUSD: partialPnl, exitPrice, isPartial: true });
            await sendTelegramAlert(`🎯 <b>TP1 ERREICHT: ${cleanSymbol}/USDT (SHORT)</b> Teil-PnL: $${partialPnl.toFixed(2)}`);
          }

          if (highPrice >= trade.stopLoss) {
            const exitPrice = applySlippage(trade.stopLoss, 'SHORT', 'exit');
            const pnlUSD = (trade.entry - exitPrice) * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - (trade.fundingCostUSD || 0);
            await recordTradePnL(pnlUSD);
            const reason = trade.tp1Hit ? 'trailing-stop' : 'stop-loss';
            await sendTelegramAlert(trade.tp1Hit ? `🔒 <b>TRAILING STOP: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}` : `🛑 <b>STOP LOSS: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
            await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: reason, pnlUSD, exitPrice });
            continue;
          }
        }
      } catch (e) {
        logger.error(`[TRACKER ERROR] ${symbol}: ${e.message}`);
      }
    }
  } catch (e) {
    logger.error(`[TRACKER CRITICAL ERROR] ${e.message}\n${e.stack}`);
  } finally {
    trackerLock = false;
  }
}

// ==========================================
// 16. SCANNER ENGINE & EVALUATION GATES
// ==========================================
async function getBitcoinTrend() {
  const rawData = await fetchKucoinKlines('BTC-USDT', '1d', 50);
  if (!rawData) return 'NEUTRAL';
  const closes = rawData.map(c => c.close);
  return calculateEMA(closes, 20) > calculateEMA(closes, 50) ? 'BULLISH' : 'BEARISH';
}

// BUGFIX: a single item whose iteratorFn call never settles (a hung DB
// query or network call with no effective timeout) used to be able to
// block the whole batch forever: the original implementation only
// removed a task from `executing` on fulfillment (`.then(onFulfilled)`,
// no onRejected), and the final `Promise.all(results)` waited on every
// single item unconditionally. One stuck item meant `asyncPool()` -
// and therefore `scanMarket()`'s `await asyncPool(...)` - never
// returned, `isScanning` stayed `true` forever, and every scheduled
// scan after that silently no-op'd via the `if (isScanning) return;`
// guard at the top of scanMarket(). This is now fixed with a hard
// per-item timeout (config.SCAN_ITEM_TIMEOUT_MS) so every task is
// guaranteed to settle, correct removal from `executing` on both
// fulfillment and rejection, and Promise.allSettled so one rejected/
// timed-out item can never keep the whole pool pending.
async function asyncPool(concurrency, items, iteratorFn, itemTimeoutMs = config.SCAN_ITEM_TIMEOUT_MS) {
  const results = [];
  const executing = [];
  const withTimeout = (item) => {
    if (!itemTimeoutMs) return Promise.resolve().then(() => iteratorFn(item));
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`asyncPool item timed out after ${itemTimeoutMs}ms`)), itemTimeoutMs);
    });
    return Promise.race([Promise.resolve().then(() => iteratorFn(item)), timeout])
      .finally(() => clearTimeout(timer));
  };
  for (const item of items) {
    const p = withTimeout(item).catch((e) => {
      logger.warn(`[ASYNC-POOL] item failed/timed out: ${e?.message || e}`);
      return undefined;
    });
    results.push(p);
    if (concurrency <= items.length) {
      const e = p.finally(() => {
        const idx = executing.indexOf(e);
        if (idx !== -1) executing.splice(idx, 1);
      });
      executing.push(e);
      if (executing.length >= concurrency) await Promise.race(executing);
    }
  }
  return Promise.allSettled(results);
}

function evaluateDirectionGates(dir, p, scanStats) {
  const isLong = dir === 'LONG';

  // --- Hard gates: structural preconditions. Without trend alignment and a
  // break of structure this isn't the strategy the bot claims to trade, so
  // these still reject immediately.
  if (filterState.trend4h.enabled && config.REQUIRE_4H_TREND) {
    const trendOk4h = isLong ? p.trend4h === 'BULLISH' : p.trend4h === 'BEARISH';
    if (!trendOk4h) return 'trendMismatch4h';
  }

  const trend1hOk = isLong ? p.trend1h === 'BULLISH' : p.trend1h === 'BEARISH';
  if (!trend1hOk) return 'trendMismatch1h';

  if (filterState.btctrend.enabled && !config.ALLOW_COUNTER_BTC_TREND) {
    const against = (p.btcTrend === 'BEARISH' && isLong) || (p.btcTrend === 'BULLISH' && !isLong);
    if (against) return 'btcCounterTrendBlocked';
  }

  if (filterState.bos.enabled) {
    const bos = isLong ? p.bosBullish : p.bosBearish;
    if (!bos) return 'noBOS';
  }

  const fundingOk = isLong ? p.fundingRate <= config.MAX_FUNDING_RATE : p.fundingRate >= config.MIN_FUNDING_RATE;
  if (!fundingOk) return 'fundingBlocked';

  // --- Soft gates: previously a rigid AND-chain of ADX / Hurst / Chop / RSI
  // zone / POC-VWAP location / MACD / relative volume. Several of these
  // measure overlapping information (ADX, Hurst and Chop are all proxies for
  // "is this trending"), so stacking them as hard booleans rejected valid
  // setups on noise in any single one. They now contribute a weighted
  // confluence score; the setup passes if enabled filters clear
  // config.MIN_GATE_SCORE (default 65/100). Per-filter counters are still
  // recorded for the existing /filter Telegram diagnostics, but no longer
  // singularly veto a setup.
  let score = 0, max = 0;

  // --- Punkt 10 - Trend Quality Score: ADX, Hurst und Chop maßen bisher alle
  // "Trendstärke" getrennt (25+20+15 = 60% der maximal erreichbaren Punkte)
  // und verdoppelten damit effektiv dieselbe Information im Confluence-Score.
  // Sie werden jetzt zu einem einzigen gewichteten Score zusammengefasst:
  //   trendQuality = (adx/100 * 0.5) + (hurst * 0.3) + ((100-chop)/100 * 0.2)
  // Ergebnis liegt zwischen 0 und 1 und ersetzt die drei separaten Blöcke.
  // Die einzelnen Filter bleiben über die FILTER_REGISTRY ein-/ausschaltbar;
  // ist einer deaktiviert, wird sein Gewichtsanteil unter den verbleibenden
  // aktiven neu verteilt, damit z.B. "nur ADX aus" nicht automatisch auch
  // Hurst/Chop unwirksam macht.
  const chopUsable = filterState.chop.enabled && p.chop;
  let trendRaw = 0, trendWeightSum = 0;
  if (filterState.adx.enabled) { trendRaw += Math.max(0, Math.min(1, p.adx / 100)) * 0.5; trendWeightSum += 0.5; }
  if (filterState.hurst.enabled) { trendRaw += Math.max(0, Math.min(1, p.hurst)) * 0.3; trendWeightSum += 0.3; }
  if (chopUsable) { trendRaw += Math.max(0, Math.min(1, (100 - p.chop) / 100)) * 0.2; trendWeightSum += 0.2; }

  if (trendWeightSum > 0) {
    max += 60;
    const trendQuality = trendRaw / trendWeightSum; // renormalisiert auf 0..1
    score += 60 * trendQuality;
    const effectiveADX = p.adaptiveADX || config.ADX_MIN;
    const belowThreshold =
      (filterState.adx.enabled && p.adx < effectiveADX) ||
      (filterState.hurst.enabled && p.hurst < config.MIN_HURST_EXPONENT) ||
      (chopUsable && p.chop > config.MAX_CHOP_INDEX);
    if (belowThreshold) scanStats.trendQualityLow++;
  }

  max += 15;
  const rsiInZone = isLong
    ? (!filterState.rsi_long_min.enabled || p.rsi >= config.RSI_LONG_MIN) && p.rsi <= config.RSI_LONG_MAX
    : p.rsi >= config.RSI_SHORT_MIN && (!filterState.rsi_short_max.enabled || p.rsi <= config.RSI_SHORT_MAX);
  if (rsiInZone) score += 15;
  else scanStats[isLong ? (p.rsi < config.RSI_LONG_MIN ? 'rsiTooLow' : 'rsiTooHigh') : (p.rsi < config.RSI_SHORT_MIN ? 'rsiTooLow' : 'rsiTooHigh')]++;

  max += 10;
  const priceOk = p.poc && p.vwap && (isLong ? (p.currentPrice >= p.poc && p.currentPrice >= p.vwap) : (p.currentPrice <= p.poc && p.currentPrice <= p.vwap));
  if (priceOk) score += 10; else scanStats.pocVwapFail++;

  max += 10;
  const macdOk = isLong ? p.macd.histogram >= 0 : p.macd.histogram <= 0;
  if (macdOk) score += 10; else scanStats.macdFail++;

  if (filterState.relvol.enabled) {
    max += 5;
    const effectiveVolume = p.adaptiveVolume || config.MIN_RELATIVE_VOLUME;
    if (effectiveVolume <= 0 || p.relativeVolume >= effectiveVolume) score += 5;
    else { score += Math.max(0, 5 * (p.relativeVolume / effectiveVolume)); scanStats.relVolTooLow++; }
  }

  const gateScore = max > 0 ? Math.round(100 * score / max) : 100;
  if (gateScore < config.MIN_GATE_SCORE) return 'lowConfluenceScore';
  return null;
}

function createEmptyScanStats() {
  return {
    total: 0, signalsSent: 0, totalSignalScore: 0, avgSignalScore: 0,
    universeLoaded: 0, watchlistReturned: 0, tradableCandidates: 0, filteredNonTradable: 0,
    marketDataEvaluated: 0, gatePassed: 0, gateRejected: 0, postGatePassed: 0,
    runtimeErrors: 0, paperExecutionRejected: 0,
    skippedActiveTrade: 0, skippedMaxSignals: 0, skippedDbDisconnected: 0,
    skippedMaxConcurrentTrades: 0, skippedDailyLossLimit: 0, skippedMaxSameDirection: 0,
    skippedExposureLimit: 0, skippedMaxDrawdown: 0, missingKlines: 0,
    trendMismatch: 0, trendMismatch1h: 0, trendMismatch4h: 0,
    btcCounterTrendBlocked: 0, trendQualityLow: 0, noBOS: 0, rsiOutOfRange: 0,
    rsiTooLow: 0, rsiTooHigh: 0, pocVwapFail: 0, macdFail: 0, fundingBlocked: 0,
    relVolTooLow: 0, cooldownActive: 0, positionTooSmallForLot: 0, correlationBlocked: 0,
    orderBookBlocked: 0, orderFlowBlocked: 0, spreadTooHigh: 0, signalHistoryBlocked: 0, skippedDynamicBlacklist: 0,
    timeBlocked: 0, newsBlackout: 0, mlBlocked: 0, dqnBlocked: 0, lowConfluenceScore: 0,
    marketDataTimeouts: 0, marketDataQueueTimeouts: 0, marketDataFailures: 0, circuitBreakerSkips: 0
  };
}

let isScanning = false;

// Punkt 14 - News-Filter: Schutz vor hoher Volatilität durch Makro-News
// (FOMC, CPI, NFP etc.). NEWS_BLACKOUT_TIMES ist eine komma-getrennte Liste
// von ISO-Zeitstempeln (UTC), die z.B. manuell aus einem Wirtschaftskalender
// wie ForexFactory gepflegt oder per Deploy-Skript aktualisiert werden kann.
// Blackout-Fenster: 30 Minuten vor bis 60 Minuten nach jedem Event - in
// diesem Fenster wird der komplette Scan ausgesetzt.
const NEWS_BLACKOUT_BEFORE_MS = 30 * 60 * 1000;
const NEWS_BLACKOUT_AFTER_MS = 60 * 60 * 1000;

function loadNewsEvents() {
  const raw = process.env.NEWS_BLACKOUT_TIMES;
  if (!raw) return [];
  return raw.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Date.parse(s))
    .filter(t => Number.isFinite(t));
}

const newsEvents = loadNewsEvents();

function isNewsBlackout(now = Date.now()) {
  return newsEvents.some(t => now >= t - NEWS_BLACKOUT_BEFORE_MS && now <= t + NEWS_BLACKOUT_AFTER_MS);
}

async function scanMarket() {
  if (isScanning) return;
  isScanning = true;
  lastScanTime = Date.now();
  logger.info(`[${new Date().toISOString().slice(0, 16)}] 🔍 Starte Scan v25.0.9 (mit DQN)...`);

  // BUGFIX: hard safety net. Even with the asyncPool per-item timeout,
  // anything awaited *before* the pool (macro/sentiment check, BTC
  // trend/klines, watchlist fetch, Kelly stats, time-filter analysis)
  // could still hang without ever throwing and leave isScanning stuck
  // on true, silently killing all future scans. This watchdog forces
  // isScanning back to false after config.SCAN_WATCHDOG_MS regardless
  // of where execution is stuck, so the bot always recovers on its own.
  let scanWatchdogFired = false;
  const scanWatchdogTimer = setTimeout(() => {
    if (isScanning) {
      scanWatchdogFired = true;
      logger.error(`🚨 [SCAN-WATCHDOG] Scan #${scanCounter + 1} lief länger als ${Math.round(config.SCAN_WATCHDOG_MS / 1000)}s und wurde zwangsweise beendet, damit künftige Scans nicht blockiert bleiben.`);
      isScanning = false;
      dashboardScanState = { ...dashboardScanState, scanning: false, finishedAt: Date.now() };
    }
  }, config.SCAN_WATCHDOG_MS);
  if (typeof scanWatchdogTimer.unref === 'function') scanWatchdogTimer.unref();

  if (!isDbConnected || isPaused) {
    logger.warn(`⚠️ Scan abgebrochen: DB=${isDbConnected}, Paused=${isPaused}`);
    isScanning = false;
    return;
  }

  const scanStats = createEmptyScanStats();
  const signalBatch = [];

  // Bug fixed: the macro/sentiment check used to run BEFORE this try block.
  // If macroEngine.evaluateMacroEnvironment() threw (e.g. the Fear & Greed
  // API call failed in an unexpected way), the exception propagated out of
  // scanMarket() without ever resetting isScanning back to false. Since
  // scanMarket() early-returns while isScanning is true, a single transient
  // macro-fetch failure would silently stop the bot from scanning ever
  // again until process restart. It's now inside the try/finally below so
  // isScanning is always reset regardless of where a failure occurs.
  try {
    if (isNewsBlackout()) {
      scanStats.newsBlackout = (scanStats.newsBlackout || 0) + 1;
      logger.warn('⚠️ Scan wegen News-Blackout (Makro-Event, z.B. FOMC/CPI/NFP) ausgesetzt.');
      return;
    }

    const macroStatus = await macroEngine.evaluateMacroEnvironment();
    if (!macroStatus.safe) {
      logger.warn(`⚠️ Scan wegen Makro-Risiko ausgesetzt (Sentiment: ${macroStatus.sentimentClass}, Wert: ${macroStatus.sentimentValue}).`);
      return;
    }

    const btcTrend = await getBitcoinTrend().catch(() => 'NEUTRAL');
    const btcKlines = await fetchKucoinKlinesCached('BTC-USDT', '15m', 100).catch(() => null);
    const btcADX = btcKlines ? calculateADX(btcKlines, 14) : 20;
    const btcATR = btcKlines ? calculateATR(btcKlines, 14) : 0;
    const btcPrice = btcKlines ? btcKlines[btcKlines.length - 1].close : 0;
    const btcVolatility = btcPrice > 0 ? btcATR / btcPrice : 0.02;

    currentMarketPhase = detectMarketPhase(btcTrend, btcADX, btcVolatility);
    adaptiveConfig = config.ENABLE_ADAPTIVE_PARAMS 
      ? getAdaptiveConfig(currentMarketPhase) 
      : { ADX_MIN_MULT: 1, ATR_STOP_MULT_ADJ: 0, TP1_MULT_ADJ: 0, VOLUME_MULT: 1 };

    const adaptiveADX = config.ADX_MIN * adaptiveConfig.ADX_MIN_MULT;
    const adaptiveATR = config.ATR_STOP_MULT + adaptiveConfig.ATR_STOP_MULT_ADJ;
    const adaptiveTP1 = config.TP1_MULT + adaptiveConfig.TP1_MULT_ADJ;
    const adaptiveVolume = config.MIN_RELATIVE_VOLUME * adaptiveConfig.VOLUME_MULT;

    let adaptiveRisk = config.RISK_PERCENT * macroStatus.riskMultiplier;
    if (config.ENABLE_KELLY_SIZING) {
      const weekStats = await getPeriodPerformanceStats(7).catch(() => null);
      if (weekStats && weekStats.totalTrades >= 20) {
        adaptiveRisk = calculateKellyRisk(
          parseFloat(weekStats.winRate), 
          weekStats.avgWin, 
          Math.abs(weekStats.avgLoss), 
          config.RISK_PERCENT
        ) * 100 * macroStatus.riskMultiplier;
      }
    }

    let timeFilterBlocked = false;
    if (filterState.timetrend.enabled && config.ENABLE_TIME_FILTER) {
      const timeStats = await getTimeBasedAnalysis();
      if (timeStats) {
        const currentHour = new Date().getUTCHours();
        const currentDay = new Date().getUTCDay();
        const hStat = timeStats.hourlyStats[currentHour];
        const dStat = timeStats.dailyStats[currentDay];
        if ((hStat && hStat.trades >= 3 && hStat.pnl < 0) || (dStat && dStat.trades >= 5 && dStat.pnl < 0)) {
          timeFilterBlocked = true;
          logger.info(`⏰ [Time-Filter] Aktuelle Stunde (${currentHour} UTC) oder Wochentag (${currentDay}) historisch im Minus. Signale werden gedrosselt.`);
        }
      }
    }

    logger.info(`📊 Phase: ${currentMarketPhase} | Sentiment: ${macroStatus.sentimentClass} (${macroStatus.sentimentValue}) | ADX: ${adaptiveADX.toFixed(1)} | Risk: ${adaptiveRisk.toFixed(2)}%`);

    const spotWatchlist = await getTopKucoinPairs(config.TOP_COIN_LIMIT).catch(() => ['BTC-USDT', 'ETH-USDT']);
    const dynamicWatchlist = contractSpecsCache.size > 0 
      ? spotWatchlist.filter(isFuturesContractTradable) 
      : spotWatchlist;

    scanStats.universeLoaded = contractSpecsCache.size || 0;
    scanStats.watchlistReturned = spotWatchlist.length;
    scanStats.tradableCandidates = dynamicWatchlist.length;
    scanStats.filteredNonTradable = Math.max(0, spotWatchlist.length - dynamicWatchlist.length);

    dashboardScanUniverse = [...dynamicWatchlist];
    dashboardScanState = { scanning: true, startedAt: Date.now(), finishedAt: null, counter: scanCounter + 1, checked: 0, signals: 0 };
    jarvisEventBus.emitEvent('SCAN:START', { scanCounter: scanCounter + 1, universe: dashboardScanUniverse, size: dashboardScanUniverse.length }, { source: 'scanner', persist: true, persistMinIntervalMs: 500 });
    dashboardScanCache.ts = 0;

    // BUGFIX (dashboard blackout, cheap version): the dashboard used to only
    // receive data for symbols that made it through the full, expensive
    // per-symbol pipeline (klines + futures + orderbook - up to 5 API calls
    // each). Forcing that full pipeline to run for every candidate just to
    // keep the dashboard populated overloaded the KuCoin API and brought
    // back scan timeouts/hangs. Instead, seed the dashboard for the WHOLE
    // universe here using data already returned by the single bulk
    // allTickers call inside getTopKucoinPairs() above - zero extra API
    // calls. Symbols that go on to pass the trading gates and reach the
    // full pipeline still get enriched with real indicators afterwards;
    // this seed is just the baseline so the dashboard is never empty.
    try {
      const bulkTickers = exchangeAdapter.getCachedTickerSnapshot ? exchangeAdapter.getCachedTickerSnapshot() : [];
      if (bulkTickers.length > 0) {
        const tickerMap = new Map(bulkTickers.map(t => [t.symbol, t]));
        const nowTs = Date.now();
        for (const symbol of dynamicWatchlist) {
          const t = tickerMap.get(symbol);
          if (!t) continue;
          const existing = dashboardLiveCoinSnapshots.get(symbol);
          // Don't clobber a fresher, fully-evaluated snapshot from the same
          // scan cycle with the cheap baseline.
          if (existing && existing.scanCounter === scanCounter + 1 && existing.scanStatus === 'EVALUATED') continue;
          dashboardLiveCoinSnapshots.set(symbol, {
            symbol, scanCounter: scanCounter + 1, scanStatus: 'LIVE_TICKER',
            price: t.price, change: t.changePct, changePct: t.changePct,
            volume24h: t.volume24hUSD, rsi: 0, bidAskRatio: 1, tech: null,
            eventTs: nowTs, source: 'bulk-ticker-lightweight'
          });
        }
      }
    } catch (e) {
      logger.warn(`[Dashboard Seed] ${e.message}`);
    }

    if (dynamicWatchlist.length === 0) {
      logger.warn('⚠️ Watchlist ist leer!');
      isScanning = false;
      return;
    }

    if (isKucoinCircuitOpen()) {
      scanStats.circuitBreakerSkips = dynamicWatchlist.length;
      logger.warn(`⏸️ [MARKET-DATA] Scan pausiert: KuCoin Circuit Breaker aktiv für weitere ${Math.ceil((kucoinCircuitOpenUntil - Date.now()) / 1000)}s.`);
      lastScanStats = scanStats;
      return;
    }

    if (config.ENABLE_PRELOADING) {
      preloadKlines(dynamicWatchlist.slice(0, 20), '15m', 100);
    }

    let signalsSent = 0;

    await asyncPool(config.SCAN_CONCURRENCY, dynamicWatchlist, async (symbol) => {
      scanStats.total++;
      dashboardScanState.checked = scanStats.total;

      if (activeTrades.has(symbol)) { 
        scanStats.skippedActiveTrade++; 
        return; 
      }

      if (await isCoinDynamicallyBlacklisted(symbol).catch(() => false)) {
        scanStats.skippedDynamicBlacklist++;
        return;
      }

      if (signalsSent >= config.MAX_SIGNALS_PER_SCAN) { 
        scanStats.skippedMaxSignals++; 
        return; 
      }

      if (timeFilterBlocked) {
        scanStats.timeBlocked++;
        return;
      }

      const preCheck = riskEngine.assess({ equity: config.CAPITAL_USD + dailyNetPnL, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions: [...activeTrades.values()] });
      if (!preCheck.allowed) {
        if (preCheck.reason && scanStats.hasOwnProperty(preCheck.reason)) {
          scanStats[preCheck.reason]++;
        } else {
          scanStats.skippedActiveTrade++;
        }
        return;
      }

      try {
        let marketData;
        try {
          marketData = await Promise.race([
            getMarketDataBundle(symbol),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${symbol} market-data bundle timed out after ${MARKET_DATA_BUNDLE_TIMEOUT_MS}ms`)), MARKET_DATA_BUNDLE_TIMEOUT_MS))
          ]);
        } catch (e) {
          if (e?.code === 'KUCOIN_CIRCUIT_OPEN') {
            scanStats.circuitBreakerSkips++;
            return;
          }
          if (e?.code === 'MARKET_DATA_QUEUE_TIMEOUT') scanStats.marketDataQueueTimeouts++;
          else if (/timed out/i.test(e?.message || '')) scanStats.marketDataTimeouts++;
          else scanStats.marketDataFailures++;
          if (e?.code === 'KLINES_UNAVAILABLE') scanStats.missingKlines++;
          logger.warn(`[MARKET-DATA] ${symbol}: ${e?.message || e}`);
          return;
        }

        const { raw15m, raw1h, raw4h, futuresData, orderBookMetrics } = marketData;
        if (!orderBookMetrics?.valid) {
          scanStats.orderBookBlocked = (scanStats.orderBookBlocked || 0) + 1;
          return;
        }

        const orderFlowEval = orderFlowManager.evaluateOrderFlow(raw15m, orderBookMetrics);

        const closes4h = raw4h ? raw4h.map(c => c.close) : [];
        const closes1h = raw1h.map(c => c.close);
        const closes15m = raw15m.map(c => c.close);
        const currentPrice = closes15m[closes15m.length - 1];

        const trend4h = closes4h.length >= 50 
          ? (calculateEMA(closes4h, 20) > calculateEMA(closes4h, 50) ? 'BULLISH' : 'BEARISH') 
          : 'NEUTRAL';
        const trend1h = calculateEMA(closes1h, 20) > calculateEMA(closes1h, 50) ? 'BULLISH' : 'BEARISH';
        const trend15m = calculateEMA(closes15m, config.TREND_EMA_FAST_15M) > calculateEMA(closes15m, config.TREND_EMA_SLOW_15M) ? 'BULLISH' : 'BEARISH';

        const adx = calculateADX(raw15m, 14);
        const hurst = calculateHurstExponent(closes15m);
        const chop = calculateChoppinessIndex(raw15m, 14);
        const rsi = calculateRSI(closes15m, 14);
        const atr = calculateATR(raw15m, 14);
        const poc = calculateVolumeProfilePOC(raw15m, 30);
        const vwap = calculateVWAP(raw15m);
        const macd = calculateMACD(closes15m);
        const { bosBullish, bosBearish } = checkSwingBreakOfStructure(raw15m, config.BOS_LOOKBACK);
        const relativeVolume = calculateRelativeVolume(raw15m, 20);
        const fundingRate = futuresData ? futuresData.fundingRate : 0;

        const gateParams = {
          trend4h, trend1h, trend15m, btcTrend, adx, hurst, chop, bosBullish, bosBearish,
          rsi, poc, vwap, currentPrice, macd, fundingRate, relativeVolume,
          adaptiveADX, adaptiveVolume
        };

        // Fully reached market-data/indicator stage. This is intentionally
        // separate from `total`: total counts candidates entering the pool,
        // while marketDataEvaluated means the symbol reached the strategy gates.
        scanStats.marketDataEvaluated++;

        var direction = null;
        const primaryDir = trend1h === 'BULLISH' ? 'LONG' : 'SHORT';
        let primaryFail = evaluateDirectionGates(primaryDir, gateParams, scanStats);

        if (!primaryFail) {
          direction = primaryDir;
        } else if (config.ENABLE_SHORT_SIGNALS || primaryDir === 'LONG') {
          const secondaryFail = evaluateDirectionGates(
            primaryDir === 'LONG' ? 'SHORT' : 'LONG', 
            gateParams,
            scanStats
          );
          if (!secondaryFail) {
            direction = primaryDir === 'LONG' ? 'SHORT' : 'LONG';
          } else {
            scanStats[primaryFail] = (scanStats[primaryFail] || 0) + 1;
          }
        } else {
          scanStats[primaryFail] = (scanStats[primaryFail] || 0) + 1;
        }

        if (direction !== null) scanStats.gatePassed++;
        else scanStats.gateRejected++;

        // JARVIS LIVE SCAN SNAPSHOT: every coin that reaches validated market-data
        // evaluation is persisted with its complete observable market state.
        // This is the canonical bridge between the live scanner and Historical
        // Intelligence: the same snapshot shown live is replayable later.
        dashboardRecordProductionScanCoin({
          symbol,
          scanCounter: scanCounter + 1,
          scanStatus: 'EVALUATED',
          price: Number(currentPrice || 0),
          changePct: Number(((currentPrice - (closes15m[Math.max(0, closes15m.length - 4)] || currentPrice)) / Math.max(1e-12, (closes15m[Math.max(0, closes15m.length - 4)] || currentPrice))) * 100),
          rsi: Number(rsi || 0),
          macdHistogram: Number(macd?.histogram || 0),
          ma20: Number(calculateEMA(closes15m, 20) || 0),
          ma50: Number(calculateEMA(closes15m, 50) || 0),
          adx: Number(adx || 0),
          atr: Number(atr || 0),
          atrPct: currentPrice > 0 ? Number((atr / currentPrice) * 100) : 0,
          hurst: Number(hurst || 0),
          chop: Number(chop || 0),
          relativeVolume: Number(relativeVolume || 0),
          trend4h, trend1h, trend15m, btcTrend,
          fundingRate: Number(fundingRate || 0),
          openInterest: Number(futuresData?.openInterest || 0),
          volume24h: Number(futuresData?.volume24h || 0),
          orderBook: {
            valid: Boolean(orderBookMetrics?.valid),
            bidAskRatio: Number(orderBookMetrics?.bidAskRatio || 0),
            bidVolume: Number(orderBookMetrics?.bidVolume || 0),
            askVolume: Number(orderBookMetrics?.askVolume || 0),
            spreadPct: Number(orderBookMetrics?.spreadPct || 0),
            depthUSD: Number(orderBookMetrics?.depthUSD || 0),
            fetchedAt: Number(orderBookMetrics?.fetchedAt || Date.now())
          },
          orderFlow: { score: Number(orderFlowEval?.score || 0), pressure: orderFlowEval?.pressure || 'UNKNOWN' },
          poc: Number(poc || 0),
          vwap: Number(vwap || 0),
          bosBullish: Boolean(bosBullish),
          bosBearish: Boolean(bosBearish),
          gateDirection: direction,
          gateStatus: direction ? 'PASS' : 'REJECT',
          gateReason: direction ? null : (primaryFail || 'NO_DIRECTION'),
          marketPhase: currentMarketPhase,
          timestamp: Date.now()
        }, direction ? 'INFO' : 'WARN');

        if (direction !== null) {
          scanStats.postGatePassed++;
          if (direction === 'LONG' && orderFlowEval.pressure === 'BEARISH_DOMINANT' && orderFlowEval.score < 35) {
            scanStats.orderFlowBlocked++;
            return;
          }
          if (direction === 'SHORT' && orderFlowEval.pressure === 'BULLISH_DOMINANT' && orderFlowEval.score > 65) {
            scanStats.orderFlowBlocked++;
            return;
          }

          const sentimentCheck = await evaluateFundingAndSentiment(fundingRate, direction);
          if (!sentimentCheck.allowed) {
            scanStats.fundingBlocked = (scanStats.fundingBlocked || 0) + 1;
            return;
          }

          const cooldownKey = `${symbol}_${direction}`;
          const lastSent = await getAlertTimestamp(cooldownKey);
          if (Date.now() - lastSent <= 2 * 3_600_000) {
            scanStats.cooldownActive++;
            return;
          }

          if (!checkCorrelationLimit(symbol, direction, activeTrades, config.ENABLE_CORRELATION_LIMITS)) {
            scanStats.correlationBlocked++;
            return;
          }

          const signalScore = calculateSignalScore({
            adx, rsi, relativeVolume, trend1h, trend4h, direction,
            marketPhase: currentMarketPhase, macdHistogram: macd.histogram
          });

          if (config.ENABLE_ORDERBOOK_ANALYSIS && signalScore > 60) {
            const obOk = direction === 'LONG' ? orderBookMetrics.bidAskRatio > 0.9 : orderBookMetrics.bidAskRatio < 1.1;
            if (!obOk) {
              scanStats.orderBookBlocked++;
              return;
            }
          }

          const pocDistancePct = poc && currentPrice ? ((currentPrice - poc) / currentPrice) * 100 : 0;
          const vwapDistancePct = vwap && currentPrice ? ((currentPrice - vwap) / currentPrice) * 100 : 0;
          const macdHistogramPct = currentPrice ? (macd.histogram / currentPrice) * 100 : 0;
          const atrPct = currentPrice ? (atr / currentPrice) * 100 : 0;

          const mlFeatures = buildMLFeatures({
            adx, rsi, relativeVolume, signalScore, atrPct, hurst,
            macdHistogramPct, pocDistancePct, vwapDistancePct,
            fundingRate, openInterest: futuresData?.openInterest || 0,
            trend4h, trend1h, trend15m, btcTrend, direction,
            marketPhase: currentMarketPhase,
            orderBookImbalance: orderBookMetrics.bidAskRatio,
            spreadPct: orderBookMetrics.spreadPct,
            volatilityRatio: btcATR > 0 ? atr / btcATR : 1
          });

          const mlPrediction = predictSignalSuccess(mlFeatures);
          if (mlPrediction.trained && mlPrediction.probability < config.ML_MIN_PREDICTION_PROBABILITY) {
            scanStats.mlBlocked++;
            return;
          }

          // ==========================================
          // 🧠 INSTITUTIONAL AGENT SUITE
          // ==========================================
          safetyController.set('pause', isPaused, isPaused ? 'runtime-paused' : 'runtime-active');
          safetyController.set('kill-switch', Boolean(riskEngine.killSwitch), riskEngine.killSwitch ? 'risk-engine-kill-switch' : 'risk-engine-clear');
          const agentEvaluation = agentSuite.evaluate({
            symbol, direction,
            spreadPct: orderBookMetrics.spreadPct,
            depthUSD: Number(orderBookMetrics.depthUSD || futuresData?.volume24h || 0),
            orderSizeUSD: Number(currentPrice || 0) * 0.001,
            apiLatencyMs: apiLatencyStats.getAverage('kucoin'),
            candleDelayMs: Math.max(0, Date.now() - new Date(raw15m?.[raw15m.length - 1]?.time || Date.now()).getTime()),
            exposurePct: (() => { const eq = Math.max(config.CAPITAL_USD + dailyNetPnL, 1); const gross = [...activeTrades.values()].reduce((sum,t) => sum + Math.abs(Number(t.notionalUSD || 0)), 0); return gross / eq * 100; })(),
            maxExposurePct: Math.max(0, Number(config.MAX_EXPOSURE_RATIO || 0)) * Math.max(1, Number(config.LEVERAGE || 1)) * 100,
            drawdownPct: Math.max(0, peakCapital > 0 ? ((peakCapital - (config.CAPITAL_USD + dailyNetPnL)) / peakCapital) * 100 : 0),
            maxDrawdownPct: MAX_DRAWDOWN_PERCENT,
            dailyLossPct: Math.max(0, -(dailyNetPnL / Math.max(config.CAPITAL_USD, 1)) * 100),
            maxDailyLossPct: Math.max(0, Number(config.MAX_DAILY_LOSS_USD || 0) / Math.max(config.CAPITAL_USD, 1) * 100),
            killSwitch: safetyController.isActive('kill-switch') || isPaused, circuitBreaker: Date.now() < kucoinCircuitOpenUntil,
            regime: { confidence: currentMarketPhase === 'RANGING' || currentMarketPhase === 'TRENDING' ? 0.75 : 0.5 },
            oosScore: Number(mlModel.getStats().validationAccuracy || 0), driftScore: Number(modelDriftMonitor.status().score || 0)
          });
          if (agentEvaluation.meta.hardBlock) {
            scanStats.agentBlocked = (scanStats.agentBlocked || 0) + 1;
            logger.warn(`[AGENT-SUPERVISOR] Signal für ${symbol} (${direction}) blockiert: ${agentEvaluation.meta.decision}`);
            return;
          }

          // ==========================================
          // 🧠 DQN AGENT VETO-GATE (AKTIVIERT)
          // ==========================================
          if (config.DQN_ENABLED && dqnAgent.isInitialized) {
            const dqnState = buildDQNStateVector({
              adx, rsi, hurst, relativeVolume, signalScore, direction,
              marketPhase: currentMarketPhase, atrPct, pocDistancePct,
              vwapDistancePct, orderBookImbalance: orderBookMetrics.bidAskRatio,
              spreadPct: orderBookMetrics.spreadPct, volatilityRatio: btcATR > 0 ? atr / btcATR : 1,
              mlProbability: mlPrediction.probability
            });
            const dqnAction = dqnAgent.act(dqnState);

            // Wenn Action = 0 (Veto/Ablehnen) und außerhalb der Exploration (Epsilon)
            if (dqnAgent.shouldVetoCandidate(dqnAction, direction) && Math.random() >= dqnAgent.epsilon) {
              scanStats.dqnBlocked++;
              logger.info(`[DQN-VETO] Trade für ${symbol} (${direction}) vom DQN-Agenten blockiert (${dqnAgent.actions[dqnAction] || dqnAction}).`);
              return;
            }
          }

          if (shouldSkipSignal(symbol, direction, signalScore)) {
            scanStats.signalHistoryBlocked++;
            return;
          }

          const volEvaluation = await volManager.evaluateVolatilityMultiplier(symbol, atr, currentPrice);

          // Punkt 12 - Entry-Zonen statt fixem Market-Entry: statt immer exakt
          // zum letzten Schlusskurs zu handeln, wird eine Entry-Zone zwischen
          // dem Close der vorletzten und der aktuellen (letzten abgeschlossenen)
          // Kerze aufgespannt. Als Referenzpreis für Slippage/Positionsgröße/
          // SL/TP dient der Mittelpunkt dieser Zone - das nähert ein
          // Limit-Order-Konzept an, ohne die restliche Risikologik zu ändern.
          const prevClose15m = closes15m.length >= 2 ? closes15m[closes15m.length - 2] : currentPrice;
          const entryZoneLow = Math.min(prevClose15m, currentPrice);
          const entryZoneHigh = Math.max(prevClose15m, currentPrice);
          const entryZoneMid = (entryZoneLow + entryZoneHigh) / 2;

          let entryPrice = config.PAPER_EXECUTION_ENABLED
            ? paperExecutionAdapter.previewFillPrice({
                symbol,
                direction,
                referencePrice: entryZoneMid,
                quantity: 0
              })
            : applySlippage(entryZoneMid, direction, 'entry');
          const atrStopDistance = atr * adaptiveATR * volEvaluation.volFactor;

          // Structure-based stop: prefer the most recent swing low/high over
          // a rigid ATR multiple, bounded to 0.8x-3x the ATR distance so a
          // stray wick can't place the stop absurdly close or absurdly far.
          const swingLevel = findSwingStop(raw15m, direction, config.BOS_LOOKBACK);
          let stopDistance = atrStopDistance;
          if (swingLevel != null && Number.isFinite(swingLevel)) {
            const swingDistance = Math.abs(entryPrice - swingLevel);
            if (swingDistance > 0) {
              stopDistance = Math.min(Math.max(swingDistance, atrStopDistance * 0.8), atrStopDistance * 3);
            }
          }

          const stopLoss = direction === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;

          // Enforce a minimum risk:reward ratio on TP1. With the default
          // TP1_MULT (1.3) vs ATR_STOP_MULT (2.3) this previously produced
          // RRR ~0.57 - a structurally losing setup even at >50% win rate.
          const tp1Distance = Math.max(stopDistance * adaptiveTP1, stopDistance * config.MIN_RRR);
          const tp2Distance = Math.max(stopDistance * config.TP2_MULT, tp1Distance * 1.3);
          const tp1 = direction === 'LONG' ? entryPrice + tp1Distance : entryPrice - tp1Distance;
          const tp2 = direction === 'LONG' ? entryPrice + tp2Distance : entryPrice - tp2Distance;

          const rawSizing = calculatePositionSize(entryPrice, stopLoss, config.CAPITAL_USD, adaptiveRisk);
          const contractSizing = roundToContractSize(rawSizing.positionSizeUnits, symbol);

          if (!contractSizing) {
            scanStats.positionTooSmallForLot++;
            return;
          }

          const sizing = {
            positionSizeUnits: contractSizing.positionSizeUnits,
            notionalUSD: contractSizing.positionSizeUnits * entryPrice,
            riskAmountUSD: Math.abs(entryPrice - stopLoss) * contractSizing.positionSizeUnits,
            contracts: contractSizing.contracts
          };

          if (signalsSent >= config.MAX_SIGNALS_PER_SCAN) return;
          if (activeTrades.has(symbol)) return;
          if (config.PAPER_EXECUTION_ENABLED && !reconciliationEngine.isHealthy()) {
            scanStats.reconciliationBlocked = (scanStats.reconciliationBlocked || 0) + 1;
            return;
          }

          const weeklyPnL = await getPeriodNetPnL(7);
          const riskCheck = riskEngine.assess({
            equity: config.CAPITAL_USD + dailyNetPnL, peakEquity: peakCapital, dailyPnL: dailyNetPnL, weeklyPnL,
            openPositions: [...activeTrades.values()], direction, consecutiveLosses, proposed: sizing,
            spreadPct: Number(orderBookMetrics.spreadPct), slippagePct: Number(config.SLIPPAGE_PERCENT || 0),
            marketDataAgeMs: Math.max(0, Date.now() - Number(orderBookMetrics.fetchedAt || Date.now()))
          });
          if (!riskCheck.allowed) {
            scanStats.riskEngineBlocked = (scanStats.riskEngineBlocked || 0) + 1;
            logger.warn(`[RISK-ENGINE] Signal blockiert: ${riskCheck.reason}`); return;
          }

          let paperOrder = null;
          if (config.PAPER_EXECUTION_ENABLED) {
            const signalId = `${symbol}:${direction}:${Date.now()}:${scanCounter}`;
            try {
              const executionResult = await executePaperExecutionThroughCore({
                symbol,
                direction,
                clientOrderId: signalId,
                action: 'OPEN',
                quantity: sizing.positionSizeUnits,
                referencePrice: entryZoneMid,
                orderBookValid: Number.isFinite(orderBookMetrics.spreadPct),
                spreadPct: Number(orderBookMetrics.spreadPct),
                marketDataAgeMs: Math.max(0, Date.now() - Number(orderBookMetrics.fetchedAt || Date.now())),
                risk: riskCheck,
                riskContext: {
                  proposed: sizing,
                  equity: config.CAPITAL_USD + dailyNetPnL,
                  peakEquity: peakCapital,
                  dailyPnL: dailyNetPnL,
                  openPositions: [...activeTrades.values()],
                  spreadPct: Number(orderBookMetrics.spreadPct),
                  slippagePct: Number(config.SLIPPAGE_PERCENT || 0),
                  marketDataAgeMs: Math.max(0, Date.now() - Number(orderBookMetrics.fetchedAt || Date.now())),
                  reducedSize: riskEngine.state === 'REDUCED'
                }
              });
              paperOrder = executionResult?.remote || null;
              if (executionResult?.state === ExecutionState.UNKNOWN) {
                isPaused = true;
                global.reconciliationHealthy = false;
                throw new Error('EXECUTION_UNKNOWN_RECONCILIATION_REQUIRED');
              }
              if (!paperOrder || !['FILLED', 'PARTIALLY_FILLED'].includes(paperOrder.status) || paperOrder.filledQty <= 0) {
                scanStats.paperExecutionRejected = (scanStats.paperExecutionRejected || 0) + 1;
                return;
              }
              // Use the actual deterministic simulated fill for all downstream risk/TP math.
              entryPrice = paperOrder.avgFillPrice;
              if (paperOrder.status === 'PARTIALLY_FILLED') {
                const filledRatio = paperOrder.filledQty / Math.max(1e-12, sizing.positionSizeUnits);
                sizing.positionSizeUnits = paperOrder.filledQty;
                sizing.contracts = Math.max(1, Math.floor((sizing.contracts || 0) * filledRatio));
                sizing.notionalUSD = paperOrder.notionalUSD;
                sizing.riskAmountUSD = Math.abs(entryPrice - stopLoss) * sizing.positionSizeUnits;
                logger.info(`[PAPER EXECUTION] ${symbol} Partial Fill: ${(filledRatio * 100).toFixed(2)}%`);
              }
            } catch (e) {
              scanStats.paperExecutionRejected = (scanStats.paperExecutionRejected || 0) + 1;
              logger.warn(`[PAPER EXECUTION] ${symbol} blockiert: ${e.message}`);
              return;
            }
          }

          await persistAlertHistoryEntry(cooldownKey, Date.now());
          signalsSent++;
          scanStats.signalsSent++;
          scanStats.totalSignalScore += signalScore;

          const dynamicLeverage = calculateDynamicLeverage(atr, currentPrice, config.LEVERAGE);

          await upsertTrade(symbol, {
            symbol, direction, entry: entryPrice, stopLoss, tp1, tp2,
            signalId: paperOrder?.signalId || `${symbol}:${direction}:${Date.now()}:${scanCounter}`,
            paperOrderId: paperOrder?.orderId || null,
            executionStatus: paperOrder?.status || 'SIGNAL_ONLY',
            executionLatencyMs: paperOrder?.latencyMs || 0,
            executionFeeUSD: paperOrder?.feeUSD || 0,
            strategyVersion: 'v22.3',
            featureVersion: process.env.FEATURE_VERSION || 'phase-a',
            modelVersion: process.env.MODEL_VERSION || 'unknown',
            configHash: paperOrder?.metadata?.configHash || null,
            // Punkt 6 - ML-Feature-Leakage: Preis zum Zeitpunkt der
            // Signalgenerierung separat vom tatsächlichen (Slippage-behafteten)
            // Fill-Preis speichern, damit das ML-Training später korrekt
            // normalisiert (siehe ml-engine.js featuresFromTrade).
            signalPriceAtEntry: currentPrice,
            entryZoneLow, entryZoneHigh,
            positionSizeUnits: sizing.positionSizeUnits,
            contracts: sizing.contracts,
            notionalUSD: sizing.notionalUSD,
            riskAmountUSD: sizing.riskAmountUSD,
            entryFeeUSD: applyFees(sizing.notionalUSD),
            entryFeePaidUSD: 0,
            fundingCostUSD: 0,
            lastFundingPeriod: 0,
            openInterestAtEntry: futuresData?.openInterest || null,
            fundingRateAtEntry: fundingRate,
            atrAtEntry: atr,
            rsiAtEntry: rsi,
            adxAtEntry: adx,
            relativeVolumeAtEntry: relativeVolume,
            trend4hAtEntry: trend4h,
            trend1hAtEntry: trend1h,
            trend15mAtEntry: trend15m,
            btcTrendAtEntry: btcTrend,
            leverage: dynamicLeverage,
            marginMode: config.MARGIN_MODE,
            tp1Hit: false,
            breakEvenActivated: false,
            partiallyClosed: false,
            startTime: Date.now(),
            maxHoldHours: config.MAX_HOLD_HOURS,
            timeStopWarningSent: false,
            signalScore,
            marketPhase: currentMarketPhase,
            adaptiveRisk,
            hurstAtEntry: hurst,
            macdHistogramAtEntry: macd.histogram,
            pocDistancePctAtEntry: pocDistancePct,
            vwapDistancePctAtEntry: vwapDistancePct,
            atrPctAtEntry: atrPct,
            orderBookImbalanceAtEntry: orderBookMetrics.bidAskRatio,
            spreadPctAtEntry: orderBookMetrics.spreadPct,
            volatilityRatioAtEntry: btcATR > 0 ? atr / btcATR : 1,
            volFactorAtEntry: volEvaluation.volFactor,
            marketStressAtEntry: volEvaluation.marketStress,
            orderFlowScoreAtEntry: orderFlowEval.score,
            orderFlowPressureAtEntry: orderFlowEval.pressure,
            mlProbabilityAtEntry: mlPrediction.probability,
            mlConfidenceAtEntry: mlPrediction.confidence,
            mlModelVersionAtEntry: mlModel.getStats().modelVersion || null
          });

          const safeSymbol = escapeHtml(symbol);
          const signalText = 
            `🚀 <b>NEUES SIGNAL: ${safeSymbol} (${direction})</b> [Score: ${signalScore}/100]\n` +
            `Entry Zone: $${entryZoneLow.toFixed(6)} - $${entryZoneHigh.toFixed(6)} (Mitte: $${entryPrice.toFixed(6)}) | SL: $${stopLoss.toFixed(6)}\n` +
            `TP1: $${tp1.toFixed(6)} | TP2: $${tp2.toFixed(6)}\n` +
            `Größe: ${sizing.contracts} Kontrakte | Risk: $${sizing.riskAmountUSD.toFixed(2)}\n` +
            `ADX: ${adx} | Hurst: ${hurst} | CVD-Score: ${orderFlowEval.score}\n` +
            `🧠 TensorFlow.js: ${mlPrediction.trained ? (mlPrediction.probability * 100).toFixed(1) + '% Erfolgswahrscheinlichkeit' : 'noch nicht trainiert'}\n` +
            `🤖 DQN Epsilon: ${dqnAgent.getStats().epsilon}`;

          if (config.ENABLE_BATCH_SIGNALS) {
            signalBatch.push({ text: signalText });
          } else {
            await sendTelegramAlert(signalText);
          }
        }
      } catch (e) {
        scanStats.runtimeErrors++;
        logger.error(`[SCAN ERROR] ${symbol}: ${e.message}`);
      }
    });

    if (config.ENABLE_BATCH_SIGNALS && signalBatch.length > 0) {
      await sendBatchedSignalAlert(signalBatch);
    }

    if (scanStats.signalsSent > 0) {
      scanStats.avgSignalScore = Math.round(scanStats.totalSignalScore / scanStats.signalsSent);
    }

    logger.info(`✅ Scan beendet – ${signalsSent} Signale gesendet (Phase: ${currentMarketPhase})`);
    logger.info(`[SCAN-DIAGNOSTICS] universe=${scanStats.universeLoaded} watchlist=${scanStats.watchlistReturned} tradable=${scanStats.tradableCandidates} filteredNonTradable=${scanStats.filteredNonTradable} candidates=${scanStats.total} evaluated=${scanStats.marketDataEvaluated} gatePassed=${scanStats.gatePassed} gateRejected=${scanStats.gateRejected} postGatePassed=${scanStats.postGatePassed} signals=${scanStats.signalsSent} runtimeErrors=${scanStats.runtimeErrors} marketDataTimeouts=${scanStats.marketDataTimeouts} marketDataFailures=${scanStats.marketDataFailures} circuitBreakerSkips=${scanStats.circuitBreakerSkips}`);

    if (marketPhaseLogsCollection && isDbConnected) {
      await marketPhaseLogsCollection.insertOne({
        timestamp: new Date(),
        marketPhase: currentMarketPhase,
        totalCoinsChecked: scanStats.total,
        signalsSent: scanStats.signalsSent,
        avgSignalScore: scanStats.avgSignalScore || 0,
        reasons: scanStats
      }).catch(err => logger.error(`[MARKET PHASE LOG ERROR] ${err.message}`));
    }
    logger.info(`📈 [PHASE-LOG] Phase: ${currentMarketPhase} | Gecheckt: ${scanStats.total} | Signale: ${signalsSent}`);

    lastScanStats = scanStats;
    scanCounter++;
    dashboardScanState = { scanning: false, startedAt: dashboardScanState.startedAt, finishedAt: Date.now(), counter: scanCounter, checked: scanStats.total, signals: signalsSent };
    dashboardScanCache.ts = 0;
    jarvisEventBus.emitEvent('SCAN:COMPLETE', { scanCounter, checked: scanStats.total, signals: signalsSent, universeSize: dashboardScanUniverse.length, marketPhase: currentMarketPhase }, { source: 'scanner', persist: true, persistMinIntervalMs: 500 });

    if (scanCounter % config.SCAN_STATS_TELEGRAM_EVERY_N_SCANS === 0) {
      await sendTelegramAlert(formatScanStatsReport(scanStats));
    }

    if (config.PAPER_EXECUTION_ENABLED) {
      const recon = reconciliationEngine.reconcile();
      if (!recon.healthy) {
        isPaused = true;
        await sendTelegramAlert(`🚨 <b>RECONCILIATION FEHLER</b> – Paper-State inkonsistent. Neue Signale wurden blockiert.`);
      }
    }

    await checkRiskLevels();

  } catch (err) {
    logger.error(`[SCAN CRITICAL ERROR] ${err.message}`);
    logger.error(err.stack);
  } finally {
    clearTimeout(scanWatchdogTimer);
    if (!scanWatchdogFired) {
      isScanning = false;
      if (dashboardScanState.scanning) {
        dashboardScanState = { ...dashboardScanState, scanning: false, finishedAt: Date.now() };
      }
    }
    dashboardScanCache.ts = 0;
  }
}

// ==========================================
// 17. TELEGRAM COMMANDS & POLLING
// ==========================================
function isAuthorizedChat(chatId) {
  const targetIds = configTelegram.chatId || config.TELEGRAM_CHAT_ID || '';
  const allowed = targetIds.split(',').map(id => id.trim()).filter(Boolean);
  return allowed.includes(String(chatId));
}

async function handleTelegramCommand(chatId, text) {
  logger.info(`📨 Telegram Command: chatId=${chatId}, text="${text}"`);
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return;
  const parts = normalizedText.split(/\s+/);
  const command = parts[0].toLowerCase().split('@')[0];
  const args = parts.slice(1);

  // ==========================================
  // 🤖 AI / AGENT CONTROL CENTER (v25.0.9)
  // Advisory controls only: hard RiskEngine/Paper safety gates remain authoritative.
  // ==========================================
  const agentAlias = (name) => {
    const raw = String(name || '').toLowerCase().replace(/_/g, '-');
    const aliases = {
      regime:'market-regime-agent', market:'market-regime-agent',
      critic:'signal-critic-agent', signal:'signal-critic-agent',
      risk:'risk-sentinel-agent', sentinel:'risk-sentinel-agent',
      confluence:'confluence-agent', macro:'news-macro-agent', news:'news-macro-agent',
      liquidity:'liquidity-agent', volume:'liquidity-agent', volatility:'volatility-agent',
      anomaly:'anomaly-agent', portfolio:'portfolio-agent', execution:'execution-agent'
    };
    return aliases[raw] || raw;
  };

  if (command === '/commands' || command === '/aicommands') {
    await sendTelegramReply(chatId,
      `<b>🤖 AI CONTROL CENTER v25.0.9</b>\n━━━━━━━━━━━━━━━━━━\n` +
      `<b>Agents</b>\n/agents /agents_status /agent &lt;name&gt;\n/agent_on &lt;name&gt; /agent_off &lt;name&gt;\n/agents_on /agents_off /agent_weights\n` +
      `<b>LLM</b>\n/llm /llm_status /llm_on /llm_off /llm_test\n` +
      `<b>Analyse</b>\n/signals /top_signals /anomalies /regime /signal &lt;symbol&gt;\n/explain &lt;symbol&gt; /confluence &lt;symbol&gt; /risk\n` +
      `<b>Monitoring</b>\n/ai_hardening /ai_architecture /drift /model_drift /agent_attribution /agent_stats\n` +
      `<b>Safety</b>\n/kill_status /pause /resume\n\n<i>AI/LLM kann niemals RiskEngine, Paper-Execution oder Safety-Gates umgehen.</i>`);
    return;
  }

  if (command === '/agents' || command === '/agents_status') {
    const rows = aiAgents.listAgents();
    const enabledCount = rows.filter(x => x.enabled).length;
    const rowsText = rows.map(x => `${x.enabled ? '🟢' : '⚪'} <code>${escapeHtml(x.name)}</code> | w=${Number(x.weight).toFixed(2)}`).join('\n');
    await sendTelegramReply(chatId, `<b>🤖 AGENTS ${enabledCount}/${rows.length} AKTIV</b>\n━━━━━━━━━━━━━━━━━━\n${rowsText}\n\nOrchestrator: ${config.AI_AGENTS_ENABLED ? '🟢 ON' : '🔴 OFF'}`);
    return;
  }

  if (command === '/agent') {
    const name = agentAlias(args[0]);
    const row = aiAgents.listAgents().find(x => x.name === name);
    if (!row) { await sendTelegramReply(chatId, '⚠️ Agent nicht gefunden. Nutze /agents.'); return; }
    await sendTelegramReply(chatId, `🤖 <b>${escapeHtml(row.name)}</b>\nStatus: ${row.enabled ? '🟢 aktiv' : '⚪ aus'}\nGewicht: <b>${Number(row.weight).toFixed(2)}</b>`);
    return;
  }

  if (command === '/agent_on' || command === '/agent_off') {
    const name = agentAlias(args[0]);
    const enabled = command === '/agent_on';
    if (!aiAgents.setAgent(name, enabled)) { await sendTelegramReply(chatId, '⚠️ Agent nicht gefunden. Nutze /agents.'); return; }
    await sendTelegramReply(chatId, `${enabled ? '🟢' : '⚪'} Agent <code>${escapeHtml(name)}</code> ${enabled ? 'aktiviert' : 'deaktiviert'}.`);
    return;
  }

  if (command === '/agents_on' || command === '/agents_off') {
    const enabled = command === '/agents_on';
    aiAgents.setAll(enabled);
    await sendTelegramReply(chatId, `${enabled ? '🟢' : '⚪'} Alle AI-Agents ${enabled ? 'aktiviert' : 'deaktiviert'}.`);
    return;
  }

  if (command === '/agent_weights') {
    const weights = aiAgents.getWeights();
    await sendTelegramReply(chatId, `<b>⚖️ AGENT WEIGHTS</b>\n━━━━━━━━━━━━━━━━━━\n${Object.entries(weights).map(([k,v]) => `• ${escapeHtml(k)}: <b>${Number(v).toFixed(2)}</b>`).join('\n')}`);
    return;
  }

  if (command === '/llm' || command === '/llm_status') {
    const st = llmEngine.status();
    await sendTelegramReply(chatId, `<b>🧠 LLM STATUS</b>\nStatus: ${st.available ? '🟢 verfügbar' : (st.enabled ? '🟡 aktiviert, aber nicht verfügbar' : '⚪ deaktiviert')}\nModel: <code>${escapeHtml(st.model)}</code>\nCooldown: ${Math.round(st.cooldownMs / 1000)}s`);
    return;
  }

  if (command === '/llm_on') {
    if (!config.GEMINI_API_KEY) { await sendTelegramReply(chatId, '⚠️ GEMINI_API_KEY fehlt. LLM bleibt deaktiviert.'); return; }
    llmEngine.enable(config.GEMINI_API_KEY); config.AI_LLM_ENABLED = true;
    await sendTelegramReply(chatId, '🟢 <b>LLM Reviewer aktiviert.</b> Er darf keine Hard-Risk-Gates umgehen.');
    return;
  }

  if (command === '/llm_off') {
    llmEngine.disable(); config.AI_LLM_ENABLED = false;
    await sendTelegramReply(chatId, '⚪ <b>LLM Reviewer deaktiviert.</b>');
    return;
  }

  if (command === '/llm_test') {
    const st = llmEngine.status();
    if (!st.available) { await sendTelegramReply(chatId, '⚠️ LLM ist nicht verfügbar. Nutze /llm_status.'); return; }
    const result = await llmEngine.analyzeSignal({ symbol:'TEST-USDT', direction:'LONG', marketPhase:currentMarketPhase, signalScore:80, mlProbability:0.72, dqnAction:1, confluenceScore:75, ichimokuScore:70, volumeMACDScore:68, cvdScore:65, trend1h:'BULLISH', trend4h:'BULLISH', adx:25, rsi:55, atrPct:1.5, spreadPct:0.05, fundingRate:0 });
    await sendTelegramReply(chatId, `🧠 <b>LLM TEST</b>\nResult: ${result.approved ? '✅ APPROVED' : '❌ REJECTED'}\nConfidence: ${(Number(result.confidence || 0) * 100).toFixed(0)}%\nRisk: ${escapeHtml(result.risk || 'N/A')}\n${(result.reasons || []).map(x => `• ${escapeHtml(x)}`).join('\n')}`);
    return;
  }

  if (command === '/ai_hardening' || command === '/ai_architecture') {
    const drift = modelDriftMonitor.status();
    const wf = walkForwardEngine.windows(1000).length;
    const attr = agentAttribution.summary().slice(0, 5).map(x => `${x.agent}: avg=${Number(x.avgScore).toFixed(2)} pnl=${Number(x.avgPnl).toFixed(2)}`).join('\n') || 'noch keine Attribution-Daten';
    await sendTelegramReply(chatId, `<b>🧠 AI HARDENING</b>\nInstitutional Agent Suite: 🟢\nAI Orchestrator: ${config.AI_AGENTS_ENABLED ? '🟢' : '⚪'}\nLLM Reviewer: ${llmEngine.status().enabled ? '🟢' : '⚪'}\nWalk-Forward-Fenster (1000 Bars): ${wf}\nDrift: ${drift.drift ? '🔴 DRIFT' : '🟢 STABLE'} (${Number(drift.score).toFixed(2)})\n\n<b>Agent Attribution</b>\n${escapeHtml(attr)}`);
    return;
  }

  if (command === '/drift' || command === '/model_drift') {
    const st = modelDriftMonitor.status();
    await sendTelegramReply(chatId, `<b>📉 MODEL DRIFT</b>\nStatus: ${st.drift ? '🔴 DRIFT' : '🟢 STABLE'}\nScore: <b>${Number(st.score).toFixed(3)}</b>\nReason: ${escapeHtml(st.reason || 'n/a')}`);
    return;
  }

  if (command === '/agent_attribution' || command === '/agent_stats') {
    const rows = agentAttribution.summary();
    await sendTelegramReply(chatId, `<b>📊 AGENT ATTRIBUTION</b>\n${rows.length ? rows.map(x => `• ${escapeHtml(x.agent)}: n=${x.count}, avg=${Number(x.avgScore).toFixed(2)}, veto=${x.vetoes}, avgPnL=${Number(x.avgPnl).toFixed(2)}`).join('\n') : 'Noch keine Daten.'}`);
    return;
  }

  if (command === '/kill_status') {
    const riskState = riskEngine.killSwitch ? '🔴 ACTIVE / FAIL-CLOSED' : '🟢 not active';
    const circuit = Date.now() < kucoinCircuitOpenUntil ? '🔴 OPEN' : '🟢 CLOSED';
    await sendTelegramReply(chatId, `🛡️ <b>SAFETY STATUS</b>\nRiskEngine kill-switch: ${riskState}\nKuCoin circuit breaker: ${circuit}\nBot paused: ${isPaused ? '🟡 YES' : '🟢 NO'}`);
    return;
  }

  if (command === '/signals' || command === '/top_signals' || command === '/anomalies' || command === '/regime') {
    const phase = currentMarketPhase || 'UNKNOWN';
    await sendTelegramReply(chatId, `📊 <b>MARKET AI SNAPSHOT</b>\nPhase: <b>${escapeHtml(phase)}</b>\nLetzter Scan: ${lastScanTime ? new Date(lastScanTime).toISOString() : 'noch keiner'}\n\nNutze /scanstats für den vollständigen Scan-Report.`);
    return;
  }

  if (command === '/risk') {
    const equity = config.CAPITAL_USD + dailyNetPnL;
    const dd = peakCapital > 0 ? ((peakCapital - equity) / peakCapital * 100) : 0;
    await sendTelegramReply(chatId, `🛡️ <b>RISK SNAPSHOT</b>\nExposure-Limit: ${((config.MAX_EXPOSURE_RATIO || 0) * 100).toFixed(1)}% Margin\nLeverage: ${config.LEVERAGE}x\nRisk/Trade: ${config.RISK_PERCENT}%\nEquity: $${equity.toFixed(2)}\nDaily PnL: $${dailyNetPnL.toFixed(2)}\nDrawdown: ${dd.toFixed(2)}%\nTrades: ${activeTrades.size}/${config.MAX_CONCURRENT_TRADES}`);
    return;
  }

  if (command === '/signal') {
    const symbol = args[0] ? (args[0].toUpperCase().endsWith('-USDT') ? args[0].toUpperCase() : `${args[0].toUpperCase()}-USDT`) : null;
    if (!symbol) { await sendTelegramReply(chatId, '⚠️ Syntax: <code>/signal BTC-USDT</code>'); return; }
    const agentRows = aiAgents.listAgents();
    const active = agentRows.filter(x => x.enabled).length;
    await sendTelegramReply(chatId, `🤖 <b>AI SIGNAL SNAPSHOT — ${escapeHtml(symbol)}</b>\nAgents: ${active}/${agentRows.length} aktiv\nMarket Phase: <b>${escapeHtml(currentMarketPhase || 'UNKNOWN')}</b>\n\nDas nächste echte Signal für dieses Symbol wird weiterhin durch ML/DQN, Agent-Orchestrator und die unveränderten Risk-/Safety-Gates bewertet.`);
    return;
  }

  if (command === '/explain') {
    const symbol = args[0] ? (args[0].toUpperCase().endsWith('-USDT') ? args[0].toUpperCase() : `${args[0].toUpperCase()}-USDT`) : null;
    if (!symbol) { await sendTelegramReply(chatId, '⚠️ Syntax: <code>/explain BTC-USDT</code>'); return; }
    await sendTelegramReply(chatId, `🧠 <b>Explain ${escapeHtml(symbol)}</b>\nDie detaillierte Erklärung wird beim nächsten Kandidaten-Scan aus Agent-, ML- und DQN-Ergebnissen erzeugt.\n\nNutze /scan für einen aktuellen Scan.`);
    return;
  }

  if (command === '/confluence') {
    const symbol = args[0] ? (args[0].toUpperCase().endsWith('-USDT') ? args[0].toUpperCase() : `${args[0].toUpperCase()}-USDT`) : null;
    await sendTelegramReply(chatId, symbol ? `🔗 <b>Confluence ${escapeHtml(symbol)}</b> wird pro Signal im Agent-Report bewertet.` : '🔗 Confluence wird pro Signal im Agent-Report bewertet. Nutze /scan und /scanstats.');
    return;
  }

  if (command === '/help' || command === '/start') {
    await sendTelegramReply(chatId,
      `<b>🤖 TRADING BOT v25.0.9 - INSTITUTIONAL PAPER/SHADOW</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>⚙️ DYNAMISCHE FILTER-STEUERUNG:</b>\n` +
      `/filters - Zeigt alle Indikator-Status & Werte an\n` +
      `/filter on/off [key] - Filter aktivieren/deaktivieren\n` +
      `/filter soft/hard [key] - Schwelle weicher/härter stellen\n` +
      `/filter reset [key] - Einen Filter auf Standard zurücksetzen\n` +
      `/filter reset all confirm - ALLE Filter auf Profil-Standard\n` +
      `/optimize [Symbol] [Tage] - Automatisches Hyperparameter-Tuning\n\n` +
      `<b>📊 Performance & Status:</b>\n` +
      `/stats - Performance heute (UTC)\n` +
      `/drawndown (oder /dd) - Aktuellen Drawdown anzeigen\n` +
      `/week - 7-Tage Performance Report\n` +
      `/month - 30-Tage Performance Report\n` +
      `/status - Gesamt-Status des Bots\n` +
      `/db - MongoDB Verbindungs-Check\n` +
      `/scanstats - Scan-Diagnose & Filter\n` +
      `/logs - Letzte 15 System-Logs anzeigen\n\n` +
      `<b>🤖 Künstliche Intelligenz & DQN:</b>\n` +
      `/ki [Frage] - Marktanalyse per KI abfragen\n` +
      `/report - Automatisches KI-Trading Briefing\n` +
      `/retrain - TensorFlow.js & DQN Agent neu trainieren\n` +
      `/download BTC-USDT 2020 15m - Historische OHLCV-Daten laden\n` +
      `/download_status - Download-Fortschritt\n` +
      `/download_cancel - Download abbrechen\n` +
      `/datasets - Lokale Datasets anzeigen\n` +
      `/update BTC-USDT 15m - Dataset fortschreiben\n\n` +
      `<b>🚨 Trade-Steuerung:</b>\n` +
      `/close [Symbol] - Einzelnen Trade schließen (z. B. <code>/close BTC-USDT</code>)\n` +
      `/closeall - ALLE aktiven Trades sofort schließen\n` +
      `/setsl [Symbol] [Preis] - SL anpassen\n` +
      `/settp [Symbol] [tp1|tp2] [Preis] - TP anpassen\n\n` +
      `<b>⚙️ Parameter & Risikomanagement:</b>\n` +
      `/setcapital [Betrag] - Startkapital ändern\n` +
      `/setpeak [Betrag] - Peak Capital manuell setzen\n` +
      `/setrisk [Prozent] - Risiko pro Trade anpassen\n` +
      `/setleverage [1-100] - Hebel anpassen\n` +
      `/setprofile [strict|loose] - Strategie-Profil umschalten\n\n` +
      `<b>🚫 Blacklist:</b>\n` +
      `/blacklist / /unblacklist [Symbol] - Coins verwalten\n` +
      `/showblacklist - Gesperrte Coins auflisten\n\n` +
      `<b>🎮 System:</b>
` +
      `/pause | /resume | /scan | /backtest [Symbol] [Days]
` +
      `<b>🧪 Paper Execution:</b>
` +
      `/paperstatus - Paper-Execution, Idempotenz & Reconciliation`

    );
    return;
  }

  if (command === '/optimize') {
    const symbolArg = args[0] ? args[0].toUpperCase() : 'BTC-USDT';
    const days = args[1] ? Number(args[1]) : 14;
    
    await sendTelegramReply(chatId, `🧬 <b>Starte Hyperparameter-Optimierung</b> für ${symbolArg} (${days} Tage)... Das kann einen Moment dauern.`);
    
    try {
      const cfg = buildBacktestConfig(process.env);
      const best = await optimizeHyperparameters(symbolArg, days, cfg);
      
      if (best) {
        config.ATR_STOP_MULT = best.atrMultiplier;
        config.ADX_MIN = best.adxMin;
        
        let report = `🎯 <b>OPTIMIERUNG ERFOLGREICH BEENDET!</b>\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `• Beste Lernrate: <code>${best.learningRate}</code>\n`;
        report += `• Bester ATR Multiplier: <b>${best.atrMultiplier}</b>\n`;
        report += `• Bestes ADX Minimum: <b>${best.adxMin}</b>\n\n`;
        report += `📈 <b>Ergebnis im Test:</b>\n`;
        report += `• Net Profit: $${best.metrics.netProfit.toFixed(2)}\n`;
        report += `• Win-Rate: ${best.metrics.winRate.toFixed(2)}%\n`;
        report += `• Sharpe Ratio: ${best.metrics.sharpe.toFixed(2)}\n\n`;
        report += `✅ <i>Die Live-Parameter des Bots wurden automatisch aktualisiert!</i>`;
        
        await sendTelegramReply(chatId, report);
      } else {
        await sendTelegramReply(chatId, `⚠️ Es konnten keine optimalen Parameter ermittelt werden.`);
      }
    } catch (e) {
      logger.error(`Optimierungsfehler: ${e.message}`);
      await sendTelegramReply(chatId, `❌ Fehler bei der Optimierung: ${escapeHtml(e.message)}`);
    }
    return;
  }

  if (command === '/drawndown' || command === '/dd') {
    const currentEquity = config.CAPITAL_USD + dailyNetPnL;
    const drawdownPercent = peakCapital > 0 ? ((peakCapital - currentEquity) / peakCapital * 100).toFixed(2) : 0;
    const maxAllowed = config.MAX_DRAWDOWN_PERCENT;

    let msg = `📉 <b>AKTUELLER DRAWDOWN STATUS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• Aktuelles Kapital: <b>$${currentEquity.toFixed(2)}</b>\n`;
    msg += `• Peak Kapital: <b>$${peakCapital.toFixed(2)}</b>\n`;
    msg += `• Aktueller Drawdown: <b>${drawdownPercent}%</b>\n`;
    msg += `• Max. Erlaubter Drawdown: <b>${maxAllowed}%</b>\n`;
    msg += `• Bot-Status: ${isPaused ? '⏸️ Pausiert' : '▶️ Aktiv'}`;

    await sendTelegramReply(chatId, msg);
    return;
  }

  if (command === '/ki' || command === '/gemini') {
    const promptText = args.join(' ') || 'Wie schätzt du die allgemeine Lage von Bitcoin und dem Kryptomarkt heute ein? Antworte kurz und präzise.';
    
    await sendTelegramReply(chatId, `🧠 <i>Frage Gemini nach einer Marktanalyse...</i>`);
    
    try {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: promptText,
      });

      const aiAnswer = response.text || 'Keine Antwort erhalten.';
      
      let report = `🤖 <b>GEMINI MARKTANALYSE</b>\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `${escapeHtml(aiAnswer)}`;
      
      await sendTelegramReply(chatId, report);
    } catch (e) {
      logger.error(`Gemini API Fehler: ${e.message}`);
      await sendTelegramReply(chatId, `⚠️ <b>Gemini ist momentan überlastet (503 Service Unavailable).</b>\nBitte versuche es in ein paar Minuten noch einmal!`);
    }
    return;
  }

  if (command === '/report' || command === '/briefing') {
    await sendTelegramReply(chatId, `📊 <i>Sammle Marktdaten und erstelle KI-Briefing...</i>`);
    
    try {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const currentEquity = config.CAPITAL_USD + dailyNetPnL;
      const openTradesCount = activeTrades.size;
      
      let tradesSummary = 'Keine offene Trades.';
      if (openTradesCount > 0) {
        tradesSummary = [...activeTrades.entries()].map(([sym, t]) => `${sym} (${t.direction}, Entry: ${t.entry})`).join(', ');
      }

      const prompt = `Erstelle einen professionellen Trading-Lagebericht basierend auf diesen Daten:
      - Aktuelle Marktphase des Bots: ${currentMarketPhase}
      - Heutige Netto-PnL: $${dailyNetPnL.toFixed(2)}
      - Aktuelles Kapital: $${currentEquity.toFixed(2)}
      - Offene Trades (${openTradesCount}): ${tradesSummary}
      
      Analysiere das kurz, professionell und motivierend auf Deutsch.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: prompt,
      });

      const aiAnswer = response.text || 'Keine Analyse erhalten.';
      
      let report = `📈 <b>KI-TRADING BRIEFING</b>\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `${escapeHtml(aiAnswer)}`;
      
      await sendTelegramReply(chatId, report);
    } catch (e) {
      logger.error(`Gemini Briefing Fehler: ${e.message}`);
      await sendTelegramReply(chatId, `⚠️ <b>Briefing fehlgeschlagen:</b> Die KI ist momentan überlastet oder nicht erreichbar.`);
    }
    return;
  }

  if (command === '/download' || command === '/update') {
    const symbol = normalizeOhlcvSymbol(args[0]);
    const timeframe = args[2] || (command === '/download' ? '15m' : null);
    if (!symbol || !timeframe || !GRANULARITY[timeframe]) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/download BTC-USDT 2020 15m</code>\noder <code>/update BTC-USDT 15m</code>');
      return;
    }
    let from;
    if (command === '/update') {
      const existing = listOhlcvDatasets().find(x => x.symbol === symbol && x.timeframe === timeframe);
      from = existing?.to || Date.now() - 30 * 86400000;
    } else {
      const year = Number(args[1]);
      if (!Number.isInteger(year) || year < 2017 || year > new Date().getUTCFullYear()) {
        await sendTelegramReply(chatId, '⚠️ Bitte ein gültiges Startjahr angeben (z. B. <code>2020</code>).');
        return;
      }
      from = Date.UTC(year, 0, 1);
    }
    const active = ohlcvJobs.get(ohlcvJobKey(symbol, timeframe));
    if (active && ['queued', 'running'].includes(active.status)) {
      await sendTelegramReply(chatId, `⏳ Für <b>${escapeHtml(symbol)} ${escapeHtml(timeframe)}</b> läuft bereits ein Download. Nutze /download_status.`);
      return;
    }
    const result = startOhlcvDownload({ symbol, timeframe, from, to: Date.now(), chatId, mode: command.slice(1) });
    await sendTelegramReply(chatId, `📥 <b>OHLCV DOWNLOAD GESTARTET</b>\n━━━━━━━━━━━━━━━━━━\nSymbol: <b>${escapeHtml(symbol)}</b>\nTimeframe: <b>${escapeHtml(timeframe)}</b>\nStart: <b>${new Date(from).toISOString().slice(0,10)}</b>\nEnde: <b>${new Date().toISOString().slice(0,10)}</b>\nJob: <code>${escapeHtml(result.job.id)}</code>\n\nNutze /download_status für den Fortschritt.`);
    return;
  }

  if (command === '/download_status') {
    const jobs = [...ohlcvJobs.values()].filter(j => ['queued', 'running'].includes(j.status));
    if (!jobs.length) { await sendTelegramReply(chatId, 'ℹ️ Kein laufender OHLCV-Download.'); return; }
    const lines = jobs.map(j => {
      const age = Math.max(0, Math.round((Date.now() - j.updatedAt) / 1000));
      return `📥 <b>${escapeHtml(j.symbol)} · ${escapeHtml(j.timeframe)}</b>\n${Math.round(j.percent)}% | ${j.candles.toLocaleString('de-DE')} Kerzen | ${j.requests} Requests | Update vor ${age}s`;
    });
    await sendTelegramReply(chatId, `<b>📊 OHLCV DOWNLOAD STATUS</b>\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n\n')}\n\n/download_cancel zum Abbrechen`);
    return;
  }

  if (command === '/download_cancel') {
    const jobs = [...ohlcvJobs.values()].filter(j => ['queued', 'running'].includes(j.status));
    if (!jobs.length) { await sendTelegramReply(chatId, 'ℹ️ Kein laufender OHLCV-Download.'); return; }
    jobs.forEach(j => { j.cancelled = true; j.updatedAt = Date.now(); });
    await sendTelegramReply(chatId, `🛑 ${jobs.length} OHLCV-Download${jobs.length === 1 ? '' : 's'} zum Abbruch markiert.`);
    return;
  }

  if (command === '/datasets') {
    const datasets = listOhlcvDatasets();
    if (!datasets.length) { await sendTelegramReply(chatId, '📦 Keine lokalen OHLCV-Datasets vorhanden.\nNutze z. B. <code>/download BTC-USDT 2020 15m</code>.'); return; }
    const lines = datasets.map(d => `• <b>${escapeHtml(d.symbol)} ${escapeHtml(d.timeframe)}</b> — ${d.bars.toLocaleString('de-DE')} Bars\n  ${String(d.from).slice(0,10)} → ${String(d.to).slice(0,10)} | gaps=${d.quality.missingBars || 0} | ${escapeHtml(d.file)}`);
    await sendTelegramReply(chatId, `<b>📦 LOKALE OHLCV-DATASETS</b>\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}`);
    return;
  }

  if (command === '/backtest') {
    const symbol = args[0] ? args[0].toUpperCase() : 'BTC-USDT';
    const days = args[1] ? Number(args[1]) : 30;
    
    await sendTelegramReply(chatId, `🔄 Starte Backtest für ${symbol} (${days} Tage)... Bitte einen Moment Geduld.`);
    
    try {
      const cfg = buildBacktestConfig(process.env);
      const result = await runBacktest({ symbol, days, cfg, useML: true, walkForward: true });
      const m = result.metrics;
      
      const emoji = m.netProfit >= 0 ? '🟢' : '🔴';
      let report = `📊 <b>BACKTEST ERGEBNIS (${result.symbol} | ${result.days} Tage)</b>\n`;
      report += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      report += `${emoji} <b>Net Profit: $${m.netProfit.toFixed(2)} (${m.returnPct.toFixed(2)}%)</b>\n`;
      report += `• Ausgeführte Trades: ${result.tradeCount} (Win-Rate: ${m.winRate.toFixed(2)}%)\n`;
      report += `• Profit Factor: ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞'}\n`;
      report += `• Max Drawdown: ${m.maxDrawdownPct.toFixed(2)}%\n`;
      report += `• Sharpe Ratio: ${m.sharpe.toFixed(2)}\n`;
      report += `• ML Retrains: ${result.mlRetrains} | Blocked: ${result.mlBlocked}`;
      
      await sendTelegramReply(chatId, report);
    } catch (e) {
      await sendTelegramReply(chatId, `❌ Backtest fehlgeschlagen: ${escapeHtml(e.message)}`);
    }
    return;
  }

  if (command === '/filters') {
    let msg = `<b>⚙️ DYNAMISCHE FILTER ÜBERSICHT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    Object.keys(FILTER_REGISTRY).forEach(key => {
      const reg = FILTER_REGISTRY[key];
      const state = filterState[key];
      const currentVal = config[reg.configKey];
      const statusEmoji = state.enabled ? '🟢' : '🔴';
      
      let diffStr = '';
      if (reg.type === 'numeric') {
        const diff = currentVal - reg.default;
        if (diff !== 0) {
          diffStr = ` (<i>${diff > 0 ? '+' : ''}${diff.toFixed(2)} vs Default ${reg.default}</i>)`;
        } else {
          diffStr = ` (<i>Default</i>)`;
        }
      }

      msg += `${statusEmoji} <b>${reg.name}</b> (<code>${key}</code>):\n`;
      msg += `   • Wert: <b>${currentVal}</b>${diffStr}\n`;
      msg += `   • Status: ${state.enabled ? 'Aktiv' : '<b>DEAKTIVIERT</b>'}\n\n`;
    });
    msg += `<i>Nutze /filter soft/hard/on/off [key] zum Anpassen.</i>`;
    await sendTelegramReply(chatId, msg);
    return;
  }

  if (command === '/filter') {
    const subAction = args[0] ? args[0].toLowerCase() : null;
    const filterKey = args[1] ? args[1].toLowerCase() : null;
    const confirmFlag = args[2] ? args[2].toLowerCase() : null;

    if (!subAction) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/filter [on|off|soft|hard|reset] [key]</code>\nBeispiel: <code>/filter soft adx</code>');
      return;
    }

    if (subAction === 'reset' && (filterKey === 'all' || !filterKey)) {
      if (filterKey === 'all' && confirmFlag === 'confirm') {
        Object.keys(FILTER_REGISTRY).forEach(k => {
          const reg = FILTER_REGISTRY[k];
          const oldVal = config[reg.configKey];
          config[reg.configKey] = reg.default;
          filterState[k].enabled = true;
          logFilterChange(k, 'RESET_ALL', oldVal, reg.default);
        });
        await persistFilterState();
        await sendTelegramReply(chatId, '🔄 <b>ALLE FILTER WURDEN AUF STANDARD ZURÜCKGESETZT!</b>');
        return;
      } else {
        await sendTelegramReply(chatId, '⚠️ <b>SICHERHEITSABFRAGE:</b> Um ALLE Filter auf Standard zurückzusetzen, tippe:\n<code>/filter reset all confirm</code>');
        return;
      }
    }

    if (!filterKey || !FILTER_REGISTRY[filterKey]) {
      const validKeys = Object.keys(FILTER_REGISTRY).map(k => `<code>${k}</code>`).join(', ');
      await sendTelegramReply(chatId, `⚠️ Ungültiger Filter-Key: <b>${escapeHtml(filterKey || '')}</b>\nGültige Keys: ${validKeys}`);
      return;
    }

    const reg = FILTER_REGISTRY[filterKey];
    const cKey = reg.configKey;
    const oldVal = config[cKey];

    if (subAction === 'on') {
      filterState[filterKey].enabled = true;
      await persistFilterState();
      await logFilterChange(filterKey, 'ENABLE', 'DISABLED', 'ENABLED');
      await sendTelegramReply(chatId, `🟢 Filter <b>${reg.name}</b> wurde <b>AKTIVIERT</b>.`);
      return;
    }

    if (subAction === 'off') {
      filterState[filterKey].enabled = false;
      await persistFilterState();
      await logFilterChange(filterKey, 'DISABLE', 'ENABLED', 'DISABLED');
      await sendTelegramReply(chatId, `🔴 Filter <b>${reg.name}</b> wurde <b>DEAKTIVIERT</b> (Gate wird übersprungen).`);
      return;
    }

    if (subAction === 'reset') {
      config[cKey] = reg.default;
      filterState[filterKey].enabled = true;
      await persistFilterState();
      await logFilterChange(filterKey, 'RESET_SINGLE', oldVal, reg.default);
      await sendTelegramReply(chatId, `🔄 Filter <b>${reg.name}</b> auf Standard zurückgesetzt (<b>${reg.default}</b>).`);
      return;
    }

    if (subAction === 'soft' || subAction === 'hard') {
      if (reg.type === 'boolean') {
        const newVal = subAction === 'soft' ? !reg.default : reg.default;
        config[cKey] = newVal;
        await persistFilterState();
        await logFilterChange(filterKey, subAction.toUpperCase(), oldVal, newVal);
        await sendTelegramReply(chatId, `⚙️ Boolean-Filter <b>${reg.name}</b> geändert: <b>${oldVal}</b> ➔ <b>${newVal}</b>`);
        return;
      }

      let delta = reg.step;
      if (subAction === 'soft') {
        delta = reg.direction === 'higher_is_harder' ? -reg.step : reg.step;
      } else {
        delta = reg.direction === 'higher_is_harder' ? reg.step : -reg.step;
      }

      let newVal = parseFloat((config[cKey] + delta).toFixed(4));
      if (reg.min !== undefined) newVal = Math.max(reg.min, newVal);
      if (reg.max !== undefined) newVal = Math.min(reg.max, newVal);

      config[cKey] = newVal;
      await persistFilterState();
      await logFilterChange(filterKey, subAction.toUpperCase(), oldVal, newVal);

      const actionText = subAction === 'soft' ? '🟢 Weicher gestellt' : '🔴 Härter gestellt';
      await sendTelegramReply(chatId, `${actionText}: <b>${reg.name}</b>\n• Alter Wert: ${oldVal}\n• Neuer Wert: <b>${newVal}</b> (Limit: ${reg.min} - ${reg.max})`);
      return;
    }

    await sendTelegramReply(chatId, `⚠️ Unbekannte Filter-Aktion: <b>${escapeHtml(subAction)}</b>. Nutze /help.`);
    return;
  }

  if (command === '/db') {
    if (!isDbConnected) {
      await sendTelegramReply(chatId, `🔴 <b>MONGODB STATUS:</b> Getrennt / Keine Verbindung!`);
      return;
    }
    const pingStart = Date.now();
    try {
      await client.db('admin').command({ ping: 1 });
      const pingMs = Date.now() - pingStart;
      
      let msg = `🟢 <b>MONGODB STATUS: VERBUNDEN</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `• Ping Latenz: <b>${pingMs} ms</b>\n`;
      msg += `• Ausstehende Schreib-Ops: <b>${dbBulkQueue.length}</b>\n`;
      msg += `• Ausstehende Closed-Trades: <b>${pendingClosedTrades.length}</b>\n`;
      msg += `• Pool-Status: Aktiv`;
      await sendTelegramReply(chatId, msg);
    } catch (e) {
      await sendTelegramReply(chatId, `⚠️ <b>MONGODB STATUS:</b> Verbindung gestört (${e.message})`);
    }
    return;
  }

  if (command === '/close') {
    const symbolArg = args[0] ? args[0].toUpperCase() : null;
    if (!symbolArg) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/close BTC-USDT</code>');
      return;
    }
    const fullSymbol = symbolArg.endsWith('-USDT') ? symbolArg : `${symbolArg}-USDT`;
    if (!activeTrades.has(fullSymbol)) {
      await sendTelegramReply(chatId, `⚠️ Kein aktiver Trade für <b>${escapeHtml(fullSymbol)}</b> gefunden.`);
      return;
    }
    const trade = activeTrades.get(fullSymbol);
    const currentPrice = (await fetchKucoinMarkPrice(fullSymbol)) || trade.entry;
    const exitPrice = applySlippage(currentPrice, trade.direction, 'exit');
    const pnlPerUnit = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
    const pnlUSD = pnlPerUnit * trade.positionSizeUnits - applyFees(trade.notionalUSD) - (trade.fundingCostUSD || 0);

    await recordTradePnL(pnlUSD);
    await removeTrade(fullSymbol, {
      symbol: fullSymbol,
      direction: trade.direction,
      closeTime: Date.now(),
      closeReason: 'manual-telegram-close',
      pnlUSD,
      exitPrice
    });
    await sendTelegramReply(chatId, `🛑 Trade für <b>${escapeHtml(fullSymbol)}</b> manuell geschlossen. PnL: $${pnlUSD.toFixed(2)}`);
    return;
  }

  if (command === '/closeall') {
    if (activeTrades.size === 0) {
      await sendTelegramReply(chatId, 'ℹ️ Keine aktiven Trades zum Schließen vorhanden.');
      return;
    }
    const count = activeTrades.size;
    for (const [symbol, trade] of activeTrades.entries()) {
      const currentPrice = (await fetchKucoinMarkPrice(symbol)) || trade.entry;
      const exitPrice = applySlippage(currentPrice, trade.direction, 'exit');
      const pnlPerUnit = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
      const pnlUSD = pnlPerUnit * trade.positionSizeUnits - applyFees(trade.notionalUSD) - (trade.fundingCostUSD || 0);
      await recordTradePnL(pnlUSD);
      await removeTrade(symbol, {
        symbol,
        direction: trade.direction,
        closeTime: Date.now(),
        closeReason: 'manual-telegram-closeall',
        pnlUSD,
        exitPrice
      });
    }
    await sendTelegramReply(chatId, `🚨 Alle <b>${count}</b> aktiven Trades wurden manuell geschlossen!`);
    return;
  }

  if (command === '/setsl') {
    const symbolArg = args[0] ? args[0].toUpperCase() : null;
    const newSl = parseFloat(args[1]);
    if (!symbolArg || isNaN(newSl)) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/setsl BTC-USDT 65000</code>');
      return;
    }
    const fullSymbol = symbolArg.endsWith('-USDT') ? symbolArg : `${symbolArg}-USDT`;
    if (!activeTrades.has(fullSymbol)) {
      await sendTelegramReply(chatId, `⚠️ Kein aktiver Trade für <b>${escapeHtml(fullSymbol)}</b>.`);
      return;
    }
    const trade = activeTrades.get(fullSymbol);
    trade.stopLoss = newSl;
    await upsertTrade(fullSymbol, trade);
    await sendTelegramReply(chatId, `✅ Stop-Loss für <b>${escapeHtml(fullSymbol)}</b> auf <b>$${newSl}</b> angepasst.`);
    return;
  }

  if (command === '/settp') {
    const symbolArg = args[0] ? args[0].toUpperCase() : null;
    const target = args[1] ? args[1].toLowerCase() : null;
    const newTp = parseFloat(args[2]);
    if (!symbolArg || !['tp1', 'tp2'].includes(target) || isNaN(newTp)) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/settp BTC-USDT tp1 68000</code>');
      return;
    }
    const fullSymbol = symbolArg.endsWith('-USDT') ? symbolArg : `${symbolArg}-USDT`;
    if (!activeTrades.has(fullSymbol)) {
      await sendTelegramReply(chatId, `⚠️ Kein aktiver Trade für <b>${escapeHtml(fullSymbol)}</b>.`);
      return;
    }
    const trade = activeTrades.get(fullSymbol);
    trade[target] = newTp;
    await upsertTrade(fullSymbol, trade);
    await sendTelegramReply(chatId, `✅ <b>${target.toUpperCase()}</b> für <b>${escapeHtml(fullSymbol)}</b> auf <b>$${newTp}</b> angepasst.`);
    return;
  }

  if (command === '/setrisk') {
    const newRisk = parseFloat(args[0]);
    if (isNaN(newRisk) || newRisk <= 0 || newRisk > 10) {
      await sendTelegramReply(chatId, '⚠️ Ungültiger Risikowert (erlaubt: 0.1% bis 10.0%). Beispiel: <code>/setrisk 0.5</code>');
      return;
    }
    config.RISK_PERCENT = newRisk;
    if (botStateCollection && isDbConnected) {
      await botStateCollection.updateOne({ _id: 'runtimeConfig' }, { $set: { RISK_PERCENT: newRisk } }, { upsert: true });
    }
    await sendTelegramReply(chatId, `⚙️ Risiko pro Trade angepasst auf: <b>${newRisk}%</b>`);
    return;
  }

  if (command === '/setprofile') {
    const profileArg = args[0] ? args[0].toLowerCase() : null;
    if (!profileArg || !STRATEGY_PROFILES[profileArg]) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/setprofile strict</code> oder <code>/setprofile loose</code>');
      return;
    }
    STRATEGY_PROFILE_NAME = profileArg;
    activeProfile = STRATEGY_PROFILES[profileArg];
    config.ALLOW_COUNTER_BTC_TREND = activeProfile.ALLOW_COUNTER_BTC_TREND;
    config.REQUIRE_4H_TREND = activeProfile.REQUIRE_4H_TREND;
    config.ADX_MIN = activeProfile.ADX_MIN;
    config.RSI_LONG_MIN = activeProfile.RSI_LONG_MIN;
    config.RSI_LONG_MAX = activeProfile.RSI_LONG_MAX;
    config.RSI_SHORT_MIN = activeProfile.RSI_SHORT_MIN;
    config.RSI_SHORT_MAX = activeProfile.RSI_SHORT_MAX;
    config.MIN_RELATIVE_VOLUME = activeProfile.MIN_RELATIVE_VOLUME;
    config.BOS_LOOKBACK = activeProfile.BOS_LOOKBACK;

    await sendTelegramReply(chatId, `🔄 Strategie-Profil gewechselt auf: <b>${profileArg.toUpperCase()}</b>`);
    return;
  }

  if (command === '/blacklist') {
    const symbolArg = args[0] ? args[0].toUpperCase() : null;
    if (!symbolArg) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/blacklist DOGE-USDT</code>');
      return;
    }
    const fullSymbol = symbolArg.endsWith('-USDT') ? symbolArg : `${symbolArg}-USDT`;
    manualBlacklist.add(fullSymbol);
    if (botStateCollection && isDbConnected) {
      await botStateCollection.updateOne({ _id: 'manualBlacklist' }, { $set: { symbols: [...manualBlacklist] } }, { upsert: true });
    }
    await sendTelegramReply(chatId, `🚫 <b>${escapeHtml(fullSymbol)}</b> wurde zur manuellen Blacklist hinzugefügt.`);
    return;
  }

  if (command === '/unblacklist') {
    const symbolArg = args[0] ? args[0].toUpperCase() : null;
    if (!symbolArg) {
      await sendTelegramReply(chatId, '⚠️ Syntax: <code>/unblacklist DOGE-USDT</code>');
      return;
    }
    const fullSymbol = symbolArg.endsWith('-USDT') ? symbolArg : `${symbolArg}-USDT`;
    manualBlacklist.delete(fullSymbol);
    if (botStateCollection && isDbConnected) {
      await botStateCollection.updateOne({ _id: 'manualBlacklist' }, { $set: { symbols: [...manualBlacklist] } }, { upsert: true });
    }
    await sendTelegramReply(chatId, `✅ <b>${escapeHtml(fullSymbol)}</b> wurde von der Blacklist entfernt.`);
    return;
  }

  if (command === '/showblacklist') {
    const list = [...manualBlacklist];
    let msg = `📜 <b>MANUELLE BLACKLIST (${list.length}):</b>\n`;
    if (list.length === 0) msg += '<i>Keine Coins manuell gesperrt.</i>';
    else msg += list.map(s => `• <code>${escapeHtml(s)}</code>`).join('\n');
    await sendTelegramReply(chatId, msg);
    return;
  }

  if (command === '/retrain') {
    await sendTelegramReply(chatId, '🧠 <i>Starte manuelles KI-Training (TensorFlow.js & DQN Agent)...</i>');
    const res = await runMLTrainingSafely(true, 'telegram');
    const dqnStats = dqnAgent.getStats();
    if (res.trained) {
      await sendTelegramReply(chatId, `🟢 <b>KI & DQN Training erfolgreich!</b>\nSamples: ${res.samples} | DQN Epsilon: ${dqnStats.epsilon}`);
    } else {
      await sendTelegramReply(chatId, `⚠️ <b>Training nicht durchgeführt:</b> ${escapeHtml(res.reason)}`);
    }
    return;
  }

  if (command === '/logs') {
    const logsToShow = recentLogs.slice(-15);
    if (logsToShow.length === 0) {
      await sendTelegramReply(chatId, '📋 Keine Logs verfügbar.');
      return;
    }
    const logText = escapeHtml(logsToShow.join('\n'));
    await sendTelegramReply(chatId, `📋 <b>LETZTE LOGS (15):</b>\n<pre>${logText}</pre>`);
    return;
  }

  if (command === '/setcapital') {
    if (!args[0]) {
      await sendTelegramReply(chatId, `⚠️ Bitte gib einen Betrag an.\nBeispiel: <code>/setcapital 15000</code>`);
      return;
    }
    const newCapital = parseFloat(args[0]);
    if (isNaN(newCapital) || newCapital <= 0) {
      await sendTelegramReply(chatId, `❌ Ungültiger Kapital-Betrag: <b>${args[0]}</b>`);
      return;
    }

    config.CAPITAL_USD = newCapital;
    peakCapital = Math.max(peakCapital, newCapital);
    await persistPeakCapital();
    
    if (botStateCollection && isDbConnected) {
      await botStateCollection.updateOne({ _id: 'runtimeConfig' }, { $set: { CAPITAL_USD: newCapital } }, { upsert: true });
    }

    await sendTelegramReply(chatId, 
      `✅ <b>Kapital erfolgreich angepasst!</b>\n` +
      `• Neues Startkapital: <b>$${newCapital.toFixed(2)}</b>\n` +
      `• Neues Peak Capital: <b>$${peakCapital.toFixed(2)}</b>`
    );
    return;
  }

  if (command === '/setpeak' || command === '/setpeakcapital') {
    if (!args[0]) {
      await sendTelegramReply(chatId, `⚠️ Bitte gib einen Betrag an.\nBeispiel: <code>/setpeak 12000</code>`);
      return;
    }
    const newPeak = parseFloat(args[0]);
    if (isNaN(newPeak) || newPeak <= 0) {
      await sendTelegramReply(chatId, `❌ Ungültiger Betrag: <b>${args[0]}</b>`);
      return;
    }

    peakCapital = newPeak;
    await persistPeakCapital();

    await sendTelegramReply(chatId, 
      `✅ <b>Peak Capital erfolgreich angepasst!</b>\n` +
      `• Neues Peak Capital: <b>$${peakCapital.toFixed(2)}</b>`
    );
    return;
  }

  if (command === '/setleverage') {
    if (!args[0]) {
      await sendTelegramReply(chatId, `⚠️ Bitte gib den Hebel an (1 - 100).\nBeispiel: <code>/setleverage 5</code>`);
      return;
    }
    const newLeverage = parseInt(args[0], 10);
    if (isNaN(newLeverage) || newLeverage < 1 || newLeverage > 100) {
      await sendTelegramReply(chatId, `❌ Ungültiger Hebel. Wähle eine Zahl zwischen 1 und 100.`);
      return;
    }

    config.LEVERAGE = newLeverage;
    
    if (botStateCollection && isDbConnected) {
      await botStateCollection.updateOne({ _id: 'runtimeConfig' }, { $set: { LEVERAGE: newLeverage } }, { upsert: true });
    }

    await sendTelegramReply(chatId, 
      `⚡ <b>Hebel erfolgreich angepasst!</b>\n` +
      `• Neuer Hebel für Signale: <b>${newLeverage}x</b> (${config.MARGIN_MODE})`
    );
    return;
  }

  if (command === '/paperstatus') {
    const recon = reconciliationEngine.getStatus();
    const positions = paperExecutionAdapter.getPositions();
    await sendTelegramReply(chatId,
      `🧪 <b>PAPER EXECUTION STATUS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• Enabled: <b>${config.PAPER_EXECUTION_ENABLED ? 'JA' : 'NEIN'}</b>\n` +
      `• Live Execution: <b>DEAKTIVIERT</b>\n` +
      `• Paper Positionen: <b>${positions.length}</b>\n` +
      `• Reconciliation: <b>${recon.healthy ? 'OK' : 'FEHLER'}</b>\n` +
      `• Checked: <code>${recon.checkedAt ? new Date(recon.checkedAt).toISOString() : 'noch nicht'}</code>\n` +
      `• Fee: <code>${config.PAPER_TAKER_FEE_PERCENT}%</code> | Slippage: <code>${config.PAPER_SLIPPAGE_PERCENT}%</code>\n` +
      `• Latency: <code>${config.PAPER_EXECUTION_LATENCY_MS}ms</code>`
    );
    return;
  }

  if (command === '/status') {
    const lines = [];
    lines.push(`🤖 <b>BOT STATUS v25.0.9 INSTITUTIONAL EDITION</b>`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Profil: ${escapeHtml(STRATEGY_PROFILE_NAME)} | Phase: ${currentMarketPhase}`);
    lines.push(`DB: ${isDbConnected ? '✅ verbunden' : '🔴 GETRENNT'}`);
    
    const mlStats = mlModel.getStats();
    const dqnStats = dqnAgent.getStats();
    let mlInfo = `ML: ${isModelTrained ? '🟢 Aktiv' : '🟡 Inaktiv'} | Samples: ${mlStats.samples || 0}`;
    let dqnInfo = `🤖 DQN: Epsilon: ${dqnStats.epsilon} | Memory: ${dqnStats.memorySize}`;
    lines.push(mlInfo);
    lines.push(dqnInfo);
    
    lines.push(`Scans: ${isPaused ? '⏸️ PAUSIERT' : '▶️ aktiv'}`);
    lines.push(`Kapital: $${config.CAPITAL_USD.toFixed(0)} | Peak: $${peakCapital.toFixed(0)}`);
    lines.push(`Hebel: ${config.LEVERAGE}x | Risk/Trade: ${config.RISK_PERCENT}%`);
    lines.push(`Offene Trades: ${activeTrades.size}/${config.MAX_CONCURRENT_TRADES}`);
    lines.push(`Heutige Netto-PnL: $${dailyNetPnL.toFixed(2)}`);
    
    const currentEquity = config.CAPITAL_USD + dailyNetPnL;
    const drawdownPercent = peakCapital > 0 ? ((peakCapital - currentEquity) / peakCapital * 100).toFixed(1) : 0;
    lines.push(`Drawdown: ${drawdownPercent}%`);
    lines.push(`Risk State: <b>${riskEngine.state}</b> | ${escapeHtml(riskEngine.reason)}`);
    lines.push(`KuCoin Fehler: ${kucoinErrorCount} | Circuit Breaker: ${Date.now() < kucoinCircuitOpenUntil ? '🚨 AKTIV' : '✅ Inaktiv'}`);

    if (activeTrades.size > 0) {
      lines.push('');
      lines.push('<b>Offene Trades:</b>');
      for (const [symbol, trade] of activeTrades.entries()) {
        const hoursElapsed = ((Date.now() - trade.startTime) / 3_600_000).toFixed(1);
        const phase = trade.tp1Hit ? 'nach TP1' : 'vor TP1';
        lines.push(
          `• ${escapeHtml(symbol)} (${trade.direction}) | Entry: $${trade.entry.toFixed(6)} | ${phase} | ${hoursElapsed}h`
        );
      }
    }
    await sendTelegramReply(chatId, lines.join('\n'));
    return;
  }

  if (command === '/scan') {
    if (isPaused) {
      await sendTelegramReply(chatId, '⚠️ Der Bot ist aktuell pausiert. Nutze erst /resume, um den Scan zu starten.');
      return;
    }
    if (isScanning) {
      await sendTelegramReply(chatId, '⏳ Ein Scan läuft bereits. Bitte warte einen Moment.');
      return;
    }
    
    await sendTelegramReply(chatId, '🔍 <b>Manueller Scan wird gestartet...</b> Bitte einen Moment Geduld.');
    
    scanMarket().then(async () => {
      await sendTelegramReply(chatId, '✅ <b>Manueller Scan beendet!</b> Prüfe die Logs / Signale.');
    }).catch(async (err) => {
      await sendTelegramReply(chatId, `❌ Fehler beim manuellen Scan: ${escapeHtml(err.message)}`);
    });
    return;
  }
  
  if (command === '/stats') {
    const stats = await getDailyPerformanceStats();
    if (stats) {
      const emoji = stats.netPnL >= 0 ? '🟢' : '🔴';
      let report = `📊 <b>PERFORMANCE HEUTE (UTC)</b>\n━━━━━━━━━━━━━━━━━━\n`;
      report += `${emoji} <b>Netto-PnL: $${stats.netPnL.toFixed(2)}</b>\n`;
      report += `• Trades: ${stats.totalTrades} | TP1: ${stats.tp1Count} | TP2: ${stats.tp2Count}\n`;
      report += `• Stop-Loss: ${stats.slCount} | Trailing: ${stats.trailingStopCount}\n`;
      report += `• Win-Rate: ${stats.winRate}%\n`;
      report += `• Ø Gewinn: $${stats.avgWin.toFixed(2)} | Ø Verlust: $${Math.abs(stats.avgLoss).toFixed(2)}`;
      await sendTelegramReply(chatId, report);
    } else {
      await sendTelegramReply(chatId, `📊 <b>PERFORMANCE HEUTE</b>\nNetto-PnL: $${dailyNetPnL.toFixed(2)}\nKeine abgeschlossenen Trades heute.`);
    }
    return;
  }

  if (command === '/week') {
    await sendTelegramReply(chatId, '📊 <i>Berechne Wochen-Performance...</i>');
    const stats = await getPeriodPerformanceStats(7);
    if (stats) await sendTelegramReply(chatId, formatPeriodPerformanceReport(stats, '📈 7-TAGE PERFORMANCE', stats.startDate, stats.endDate));
    else await sendTelegramReply(chatId, '❌ Fehler beim Abrufen der Wochen-Performance.');
    return;
  }

  if (command === '/month') {
    await sendTelegramReply(chatId, '📊 <i>Berechne Monats-Performance...</i>');
    const stats = await getPeriodPerformanceStats(30);
    if (stats) await sendTelegramReply(chatId, formatPeriodPerformanceReport(stats, '📈 30-TAGE PERFORMANCE', stats.startDate, stats.endDate));
    else await sendTelegramReply(chatId, '❌ Fehler beim Abrufen der Monats-Performance.');
    return;
  }

  if (command === '/scanstats') {
    if (lastScanStats) await sendTelegramReply(chatId, formatScanStatsReport(lastScanStats));
    else await sendTelegramReply(chatId, 'Noch keine Scan-Statistik verfügbar.');
    return;
  }

  if (command === '/pause') {
    isPaused = true;
    await persistPauseState();
    await sendTelegramReply(chatId, '⏸️ Bot pausiert.');
    return;
  }

  if (command === '/resume') {
    isPaused = false;
    await persistPauseState();
    await sendTelegramReply(chatId, '▶️ Bot wieder aktiv.');
    return;
  }

  await sendTelegramReply(chatId, `❓ Unbekannter Befehl: "${escapeHtml(command)}"\n/help für Hilfe.`);
}

let telegramOffset = 0;

async function pollTelegramUpdates() {
  setInterval(() => {
    if (!isShuttingDown) logger.info('💓 Telegram polling alive');
  }, 1800000);
  
  const token = configTelegram.botToken || config.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  while (!isShuttingDown) {
    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, {
        params: { offset: telegramOffset, timeout: 25 },
        timeout: 30000
      });
      const updates = res.data?.result || [];
      for (const update of updates) {
        telegramOffset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;
        if (!isAuthorizedChat(msg.chat.id)) continue;
        await handleTelegramCommand(msg.chat.id, msg.text);
      }
    } catch (e) {
      if (e.response?.status === 409) {
        try { await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook`); } catch (e2) { logger.warn?.(`[RUNTIME] Webhook cleanup failed: ${e2.message}`); }
      }
      logger.error(`Telegram poll error: ${e.message}`);
      await sleep(5000);
    }
  }
}

// ==========================================
// 18. EXPRESS ENDPOINTS & WEB-BACKTEST
// ==========================================
const app = express();
app.use(express.json({ limit: '256kb' }));

// Institutional API boundary: authenticated by default, fail-closed.
app.use((req, res, next) => {
  // Liveness endpoint is intentionally public: UptimeRobot cannot supply
  // the bot's private API key. Authentication remains mandatory everywhere else,
  // including the dashboard and its /api/dashboard/* data endpoints, which
  // expose live strategy/portfolio internals and must never be reachable by
  // an unauthenticated caller on a publicly bound (0.0.0.0) deployment.
  if (req.path === '/health') return next();
  if (config.ALLOW_UNAUTHENTICATED_API) return next();
  if (!config.API_KEY) return res.status(503).json({ error: 'API_KEY_NOT_CONFIGURED' });
  // EventSource (used by /api/dashboard/events/stream) cannot set custom
  // headers, so the key may also be supplied as a query parameter for that
  // one case. It still must match exactly; nothing is exempted from auth.
  const suppliedKey = req.get('X-API-Key') || req.query.apiKey;
  if (suppliedKey !== config.API_KEY) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
});

app.get('/', (req, res) => {
  res.send(`🤖 Trading Bot v25.0.9 Institutional Edition | Phase: ${currentMarketPhase} | DB: ${isDbConnected ? '✅' : '🔴'}`);
});


// ---------------------------------------------------------------------------
// JARVIS LIVE NEURAL DASHBOARD
// Uses the existing ExchangeAdapter + RiskEngine + MacroFilterEngine boundary.
// No mock market values are generated here. The browser polls this endpoint
// every 2.5s and receives live/closed-candle market data from KuCoin Futures.
// ---------------------------------------------------------------------------
const dashboardCache = new Map();
const DASHBOARD_CACHE_MS = 1200;
let dashboardEventCounter = 0;
let dashboardScanUniverse = [];
let dashboardScanState = { scanning: false, startedAt: null, finishedAt: null, counter: 0, checked: 0, signals: 0 };
const dashboardScanCache = { ts: 0, data: null };
const dashboardMarketOverviewCache = { ts: 0, data: null };
const dashboardPortfolioLearningCache = { ts: 0, data: null };
const dashboardOiHistory = new Map();
const dashboardDecisionReplay = [];

// ---------------------------------------------------------------------------
// LIVE SCANNER BRIDGE 6.10
// The dashboard consumes the SAME SCAN:COIN events emitted by the production
// scanner. No second synthetic market scanner is used for the live matrix.
// ---------------------------------------------------------------------------
const dashboardLiveCoinSnapshots = new Map();
let dashboardLastLiveScanCounter = 0;
jarvisEventBus.on('event', (event) => {
  if (!event || event.type !== 'SCAN:COIN' || !event.symbol) return;
  const payload = event.payload || {};
  dashboardLiveCoinSnapshots.set(String(event.symbol).toUpperCase(), {
    ...payload,
    symbol: String(event.symbol).toUpperCase(),
    eventTs: Number(event.ts || Date.now()),
    source: 'production-scanner'
  });
  dashboardLastLiveScanCounter = Math.max(dashboardLastLiveScanCounter, Number(payload.scanCounter || 0));
});

function dashboardRecordProductionScanCoin(snapshot, severity = 'INFO') {
  if (!snapshot || !snapshot.symbol) return null;
  const event = jarvisEventBus.emitEvent('SCAN:COIN', snapshot, {
    source: 'scanner',
    severity,
    persist: true,
    persistReplay: true,
    persistMinIntervalMs: 0
  });
  return event;
}

function dashboardLiveScannerRows() {
  const symbols = dashboardScanUniverse.length
    ? dashboardScanUniverse
    : [...dashboardLiveCoinSnapshots.keys()];
  return symbols.map(symbol => dashboardLiveCoinSnapshots.get(String(symbol).toUpperCase()))
    .filter(Boolean)
    .sort((a,b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));
}

const DASHBOARD_REPLAY_MAX = 240;

function pushDashboardReplay(snapshot) {
  if (!snapshot || !snapshot.symbol) return;
  const item = { ...snapshot, id: ++dashboardEventCounter, timestamp: Date.now() };
  dashboardDecisionReplay.unshift(item);
  if (dashboardDecisionReplay.length > DASHBOARD_REPLAY_MAX) dashboardDecisionReplay.length = DASHBOARD_REPLAY_MAX;
  jarvisEventBus.emitEvent('DECISION:REPLAY', item, { source: 'decision-core', severity: item.vetoes?.length ? 'WARN' : 'INFO', persist: true, persistReplay: true, persistMinIntervalMs: 0 });
}

function dashboardAgentPerformance() {
  const rows = [];
  for (const [key, h] of signalPerformanceHistory.entries()) {
    const [symbol, direction] = key.split('_');
    const signals = Number(h.signals || 0);
    const wins = Number(h.wins || 0);
    rows.push({ symbol, direction, signals, wins, winRate: signals ? wins / signals * 100 : 0, totalPnL: Number(h.totalPnL || 0), lastUpdate: h.lastUpdate || 0 });
  }
  return rows.sort((a,b) => b.lastUpdate - a.lastUpdate).slice(0, 100);
}

function dashboardReadinessSnapshot() {
  const equity = config.CAPITAL_USD + dailyNetPnL;
  const risk = riskEngine.assess({ equity, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions: [...activeTrades.values()] });
  const recon = reconciliationEngine.getStatus ? reconciliationEngine.getStatus() : { healthy: reconciliationEngine.healthy !== false };
  const checks = readinessGate.evaluate({
    apiKeyConfigured: Boolean(config.API_KEY || config.ALLOW_UNAUTHENTICATED_API),
    paperExecution: Boolean(config.PAPER_EXECUTION_ENABLED),
    reconciliationHealthy: recon.healthy !== false,
    dataFeedHealthy: kucoinErrorCount < 3 && Date.now() >= kucoinCircuitOpenUntil,
    riskEngineHealthy: risk.allowed === true,
    oosValidated: Number(mlModel.getStats().validationAccuracy || 0) >= Number(process.env.PRODUCTION_MIN_OOS_ACCURACY || 0.55),
    rollbackReady: Boolean(process.env.MODEL_REGISTRY_DIR || process.env.DQN_REGISTRY_DIR),
    auditTrail: Boolean(auditTrail && auditTrail.file),
    independentOosEvidence: process.env.PRODUCTION_OOS_EVIDENCE === 'true',
    shadowValidated: process.env.SHADOW_VALIDATED === 'true',
    reconciliationDrillPassed: process.env.RECON_DRILL_PASSED === 'true',
    securityReviewApproved: process.env.SECURITY_REVIEW_APPROVED === 'true',
    humanApproval: process.env.HUMAN_APPROVAL === 'true'
  });
  return { ready: Boolean(checks.ready), checks, risk: { allowed: risk.allowed, level: risk.level, reason: risk.reason, equity, dailyPnL: dailyNetPnL, drawdownPct: peakCapital > 0 ? ((peakCapital - equity) / peakCapital * 100) : 0 }, execution: { enabled: false, paperOnly: true, shadowEnabled: true, liveOrders: false } };
}


function dashboardCorrelation(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0);
  if (n < 10) return 0;
  const x = a.slice(-n).map(Number), y = b.slice(-n).map(Number);
  const mx = x.reduce((s,v)=>s+v,0)/n, my = y.reduce((s,v)=>s+v,0)/n;
  let num=0, dx=0, dy=0;
  for(let i=0;i<n;i++){ const ax=x[i]-mx, by=y[i]-my; num+=ax*by; dx+=ax*ax; dy+=by*by; }
  return dx>0&&dy>0 ? num/Math.sqrt(dx*dy) : 0;
}

async function getDashboardPortfolioLearning() {
  const now = Date.now();
  if (dashboardPortfolioLearningCache.data && now - dashboardPortfolioLearningCache.ts < 4500) return dashboardPortfolioLearningCache.data;

  const equity = Number(config.CAPITAL_USD || 0) + Number(dailyNetPnL || 0);
  const positions = [];
  for (const [sym, trade] of activeTrades.entries()) {
    const direction = String(trade.direction || 'LONG').toUpperCase();
    let mark = Number(trade.entry || 0);
    try { mark = Number(await fetchKucoinTickerPrice(sym)) || mark; } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }
    const units = Number(trade.positionSizeUnits || trade.quantity || 0);
    const notional = Number(trade.notionalUSD || (Math.abs(units) * mark) || 0);
    const entry = Number(trade.entry || mark);
    const pnl = direction === 'SHORT' ? (entry - mark) * units : (mark - entry) * units;
    positions.push({ symbol:sym, direction, entry, mark, units, notionalUSD:Math.abs(notional), unrealizedPnL:pnl, pct: equity>0 ? Math.abs(notional)/equity*100 : 0 });
  }
  const gross = positions.reduce((s,p)=>s+p.notionalUSD,0);
  const net = positions.reduce((s,p)=>s+(p.direction==='SHORT'?-p.notionalUSD:p.notionalUSD),0);
  const maxConcentration = positions.length ? Math.max(...positions.map(p=>p.pct)) : 0;
  const risk = riskEngine.assess({ equity, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions:[...activeTrades.values()] });

  const matrix = await getDashboardScanMatrix();
  const universe = (matrix.rows||[]).slice(0,12).map(r=>r.symbol);
  const series = new Map();
  await asyncPool(4, universe, async sym => {
    try {
      const candles = await fetchKucoinKlinesCached(sym,'15m',60);
      const closes=(candles||[]).map(c=>Number(c.close)).filter(Number.isFinite);
      const returns=[]; for(let i=1;i<closes.length;i++) returns.push(closes[i]/closes[i-1]-1);
      series.set(sym, returns.slice(-50));
    } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }
  });
  const correlations=[];
  const syms=[...series.keys()];
  for(let i=0;i<syms.length;i++) for(let j=i+1;j<syms.length;j++){
    const corr=dashboardCorrelation(series.get(syms[i]),series.get(syms[j]));
    if(Math.abs(corr)>=0.55) correlations.push({a:syms[i],b:syms[j],correlation:Number(corr.toFixed(3)),risk:Math.abs(corr)>=0.8?'HIGH':Math.abs(corr)>=0.65?'MEDIUM':'WATCH'});
  }
  correlations.sort((a,b)=>Math.abs(b.correlation)-Math.abs(a.correlation));

  let closed=[];
  if (closedTradesCollection && isDbConnected) {
    try { closed = await closedTradesCollection.find({isPartial:{$ne:true},closeTime:{$exists:true}}).sort({closeTime:-1}).limit(500).toArray(); } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }
  }
  const rewards=closed.map(t=>DeepQTheTradingAgent.riskAdjustedReward({pnlUSD:Number(t.pnlUSD||0),drawdownPct:Number(t.drawdownPct||0),slippagePct:Number(t.slippagePct||0),exposurePct:Number(t.exposurePct||0),goodExit:Boolean(t.goodExit)}));
  const avgReward=rewards.length?rewards.reduce((a,b)=>a+b,0)/rewards.length:0;
  const wins=closed.filter(t=>Number(t.pnlUSD||0)>0).length;
  const losses=closed.filter(t=>Number(t.pnlUSD||0)<=0).length;
  const modelRegistry=(()=>{try{return {production:dqnAgent.registry.production(),models:dqnAgent.registry.list().slice(-8)}}catch(_){return {production:null,models:[]}}})();
  const dqnStats=dqnAgent.getStats();
  const training={
    algorithm:dqnStats.algorithm,
    modelVersion:dqnStats.modelVersion,
    replayBuffer:dqnStats.memorySize,
    trainingSteps:dqnStats.trainingSteps,
    epsilon:dqnStats.epsilon,
    actions:dqnStats.actions,
    closedTrades:closed.length,
    wins, losses,
    winRate:closed.length?wins/closed.length*100:0,
    avgReward,
    lastClosedAt:closed[0]?.closeTime||null,
    feedbackActive:Boolean(closed.length),
    validationAccuracy:Number(mlModel.getStats().validationAccuracy||0),
    drift:modelDriftMonitor.status(),
    registry:modelRegistry
  };
  const rewardsByAction={HOLD:[],LONG:[],SHORT:[],REDUCE:[],EXIT:[]};
  closed.forEach((t,i)=>{const action=t.direction==='LONG'?'LONG':t.direction==='SHORT'?'SHORT':'HOLD'; if(rewardsByAction[action]) rewardsByAction[action].push(rewards[i]||0)});
  const actionRewards=Object.fromEntries(Object.entries(rewardsByAction).map(([k,v])=>[k,{samples:v.length,avgReward:v.length?v.reduce((a,b)=>a+b,0)/v.length:0}]));
  jarvisEventBus.emitEvent('RL:FEEDBACK', { closedTrades: closed.length, wins, losses, avgReward, modelVersion: dqnStats.modelVersion, replayBuffer: dqnStats.memorySize, trainingSteps: dqnStats.trainingSteps }, { source: 'rl-feedback', persist: Boolean(closed.length), persistMinIntervalMs: 10000 });
  const result={timestamp:now,portfolio:{equity,dailyPnL:Number(dailyNetPnL||0),grossExposureUSD:gross,netExposureUSD:net,exposurePct:equity>0?gross/equity*100:0,maxConcentrationPct:maxConcentration,unrealizedPnL:positions.reduce((s,p)=>s+p.unrealizedPnL,0),openPositions:positions.length,risk:{allowed:Boolean(risk.allowed),level:risk.level,reason:risk.reason},positions},correlation:{pairs:correlations.slice(0,24),highRiskCount:correlations.filter(x=>x.risk==='HIGH').length},learning:{...training,actionRewards},safety:{liveExecution:false,paperOnly:true,shadowOnly:true,autoPromotion:false,modelPromotionRequiresValidation:true}};
  dashboardPortfolioLearningCache.ts=now; dashboardPortfolioLearningCache.data=result; return result;
}

function dashboardRegimeSnapshot() {
  const phase = currentMarketPhase || 'UNKNOWN';
  const confidence = phase === 'RANGING' || phase === 'TRENDING' ? 0.75 : 0.5;
  return { phase, confidence, source: 'runtime-market-phase', adaptive: true, description: phase === 'TRENDING' ? 'Trend-following conditions' : phase === 'RANGING' ? 'Mean-reversion / range conditions' : 'Elevated uncertainty / defensive mode' };
}


function dashboardFlowPressure(row, book) {
  const ch = Math.abs(Number(row.change || 0));
  const vol = Number(row.volume24h || 0);
  const oi = Number(row.openInterest || 0);
  const imbalance = Number(book?.bidAskRatio || 1);
  const volumeScore = Math.min(100, Math.log10(Math.max(1, vol)) * 7);
  const oiScore = Math.min(100, Math.log10(Math.max(1, oi)) * 7);
  const bookScore = Math.min(100, Math.abs(imbalance - 1) * 120);
  return Math.round(Math.min(100, ch * 8 + volumeScore * .35 + oiScore * .25 + bookScore * .4));
}

async function getDashboardMarketOverview() {
  const now = Date.now();
  const liveRows = dashboardLiveScannerRows();
  // The live dashboard is intentionally sourced from the production scanner.
  // If a scan has not yet produced snapshots, report WAITING instead of
  // inventing a parallel market universe.
  if (liveRows.length) {
    const rows = liveRows.map(r => ({
      ...r,
      price: Number(r.price || 0),
      change: Number(r.changePct || 0),
      rsi: Number(r.rsi || 0),
      macd: Number(r.macdHistogram || 0),
      ma20: Number(r.ma20 || 0),
      ma50: Number(r.ma50 || 0),
      trend: String(r.trend1h || '').includes('BULL') ? 'BULL' : String(r.trend1h || '').includes('BEAR') ? 'BEAR' : 'FLAT',
      tech: Number(r.rsi || 0) >= 25 && Number(r.rsi || 0) <= 75,
      volume24h: Number(r.volume24h || 0),
      fundingRate: Number(r.fundingRate || 0),
      openInterest: Number(r.openInterest || 0),
      oiDeltaPct: Number(r.oiDeltaPct || 0),
      spreadPct: Number(r.orderBook?.spreadPct || 0),
      bidAskRatio: Number(r.orderBook?.bidAskRatio || 1),
      bidVolume: Number(r.orderBook?.bidVolume || 0),
      askVolume: Number(r.orderBook?.askVolume || 0),
      whalePressure: Number(r.whalePressure || 0),
      liquidationPressure: Number(r.liquidationPressure || 0),
      volumeIntensity: Number(r.volumeIntensity || 0),
      scanCounter: Number(r.scanCounter || 0),
      gateStatus: r.gateStatus || '—',
      gateDirection: r.gateDirection || null,
      gateReason: r.gateReason || null,
      marketPhase: r.marketPhase || currentMarketPhase,
      ageMs: Math.max(0, now - Number(r.eventTs || r.timestamp || now)),
      live: true
    }));
    return {
      timestamp: now,
      source: 'PRODUCTION_SCANNER',
      scan: { ...dashboardScanState, universe: dashboardScanUniverse, lastLiveScanCounter: dashboardLastLiveScanCounter },
      rows,
      market: {
        total: rows.length,
        fundingAvg: rows.length ? rows.reduce((a,r)=>a+Number(r.fundingRate||0),0)/rows.length : 0,
        oiTotal: rows.reduce((a,r)=>a+Number(r.openInterest||0),0),
        volumeTotal: rows.reduce((a,r)=>a+Number(r.volume24h||0),0),
        bullish: rows.filter(r=>r.trend==='BULL').length,
        bearish: rows.filter(r=>r.trend==='BEAR').length,
        whaleAlerts: rows.filter(r=>Number(r.whalePressure)>=65).length,
        liquidationAlerts: rows.filter(r=>Number(r.liquidationPressure)>=65).length
      }
    };
  }
  return { timestamp: now, source: 'PRODUCTION_SCANNER_WAITING', scan: { ...dashboardScanState, universe: dashboardScanUniverse }, rows: [], market: { total: 0, fundingAvg: 0, oiTotal: 0, volumeTotal: 0, bullish: 0, bearish: 0, whaleAlerts: 0, liquidationAlerts: 0 } };
}


function dashboardSma(values, period) {
  if (!values?.length) return 0;
  const a = values.slice(-period);
  return a.reduce((sum, v) => sum + Number(v || 0), 0) / Math.max(1, a.length);
}

async function getDashboardScanMatrix() {
  // Read-only dashboard projection. Never fetch KuCoin data here.
  const rows = await dashboardLiveScannerRows();
  return rows;
}

function dashboardSharpe(closes) {
  if (!closes || closes.length < 20) return 0;
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const mean = r.reduce((a,b) => a+b, 0) / r.length;
  const variance = r.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, r.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? Number((mean / sd * Math.sqrt(96 * 365)).toFixed(2)) : 0;
}

function dashboardBollinger(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return { middle: closes?.at(-1) || 0, upper: 0, lower: 0, position: 'MID' };
  const a = closes.slice(-period);
  const mean = a.reduce((x,y) => x+y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x,y) => x + Math.pow(y-mean,2), 0) / a.length);
  const upper = mean + mult * sd, lower = mean - mult * sd, price = closes.at(-1);
  return { middle: mean, upper, lower, position: price >= upper ? 'UPPER' : price <= lower ? 'LOWER' : 'MID' };
}

function dashboardVolatility(closes) {
  if (!closes || closes.length < 20) return 0;
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i-1]));
  const mean = r.reduce((a,b)=>a+b,0)/r.length;
  const sd = Math.sqrt(r.reduce((a,b)=>a+Math.pow(b-mean,2),0)/Math.max(1,r.length-1));
  return sd * Math.sqrt(96) * 100;
}

async function getDashboardData(symbol) {
  const cached = dashboardCache.get(symbol);
  if (cached && Date.now() - cached.ts < DASHBOARD_CACHE_MS) return cached.data;

  const [marketDataResult, tickerResult, macro] = await Promise.allSettled([
    getMarketDataBundle(symbol),
    fetchKucoinTickerPrice(symbol),
    macroEngine.evaluateMacroEnvironment().catch(() => ({ value: 50, classification: 'Neutral', safe: true, multiplier: 1 }))
  ]);

  if (marketDataResult.status !== 'fulfilled' || tickerResult.status !== 'fulfilled') {
    throw new Error('LIVE_MARKET_DATA_UNAVAILABLE');
  }

  const { raw15m: candles, orderBookMetrics: book, futuresData: contract } = marketDataResult.value;
  const ticker = tickerResult.value;
  if (!candles || candles.length < 50 || !Number.isFinite(ticker)) {
    throw new Error('LIVE_MARKET_DATA_UNAVAILABLE');
  }

  const closes = candles.map(c => c.close);
  const price = Number(ticker);
  const prev24h = closes[Math.max(0, closes.length - 97)] || closes[0] || price;
  const change24h = ((price - prev24h) / prev24h) * 100;
  const volume24h = candles.slice(-96).reduce((sum, c) => sum + Number(c.volume || 0) * Number(c.close || 0), 0);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const ma20 = calculateEMA(closes, 20);
  const ma50 = calculateEMA(closes, 50);
  const bb = dashboardBollinger(closes);
  const trend = ma20 > ma50 ? 'BULLISH' : ma20 < ma50 ? 'BEARISH' : 'NEUTRAL';
  const volatilityPct = dashboardVolatility(closes);
  const sharpe = dashboardSharpe(closes);
  const returns = [];
  for (let i=1;i<closes.length;i++) returns.push((closes[i]-closes[i-1])/closes[i-1]);
  const sorted = [...returns].sort((a,b)=>a-b);
  const q = sorted[Math.max(0, Math.floor(sorted.length * .05))] || 0;
  const var95 = Math.abs(q) * price;
  const peak = Math.max(...closes);
  const drawdownPct = peak > 0 ? ((price - peak) / peak) * 100 : 0;
  const technicalAllowed = rsi >= 25 && rsi <= 75;

  const funding = Number(contract?.fundingRate || 0);
  const imbalance = Number(book?.bidAskRatio || 1);
  const orderFlowBias = imbalance > 1.15 ? 'BUY PRESSURE' : imbalance < .87 ? 'SELL PRESSURE' : 'BALANCED';
  const sentimentBias = macro.sentimentValue >= 55 ? 'BULLISH' : macro.sentimentValue <= 45 ? 'BEARISH' : 'NEUTRAL';
  const sentimentAllowed = macro.safe !== false && macro.sentimentValue >= 30;

  const liveRiskCheck = riskEngine.assess({ equity: config.CAPITAL_USD + dailyNetPnL, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions: [...activeTrades.values()] });
  const riskAllowed = liveRiskCheck.allowed === true && volatilityPct <= 6 && sharpe >= .5;
  const approvals = [technicalAllowed, sentimentAllowed, riskAllowed].filter(Boolean).length;
  let action = 'VERWERFEN';
  if (approvals === 3) action = macd.histogram >= 0 ? 'KAUFEN' : 'VERKAUFEN';
  const confidence = Math.round(Math.max(55, Math.min(99, 60 + approvals * 10 + Math.abs(macd.histogram / Math.max(price,1))*10000)));
  const reason = approvals < 3
    ? (!technicalAllowed ? `Technical Veto: RSI ${rsi.toFixed(1)} außerhalb 25–75` : !sentimentAllowed ? `Sentiment Veto: Fear & Greed ${macro.sentimentValue}` : `Risk Veto: Vol ${volatilityPct.toFixed(2)}% / Sharpe ${sharpe.toFixed(2)}`)
    : `Konsens ${approvals}/3 · RSI ${rsi.toFixed(1)} · MACD ${macd.histogram >= 0 ? 'positiv' : 'negativ'} · Risk OK`;

  const data = {
    symbol,
    market: {
      price, timestamp: Date.now(), change24h,
      volume24h,
      orderBook: book,
      contract
    },
    candles,
    technical: {
      rsi, macd, ma20, ma50,
      bbPosition: bb.position,
      trend,
      allowed: technicalAllowed,
      reason: technicalAllowed ? '✓ TECHNICAL PASSED' : `RSI ${rsi.toFixed(1)} außerhalb Grenzbereich`
    },
    sentiment: {
      value: macro.sentimentValue,
      classification: macro.sentimentClass,
      allowed: sentimentAllowed,
      fundingRate: funding,
      orderFlow: orderFlowBias,
      bias: sentimentBias,
      reason: sentimentAllowed ? `✓ MACRO ${macro.sentimentClass}` : `F&G ${macro.sentimentValue} blockiert`
    },
    risk: {
      volatilityPct,
      sharpe,
      drawdownPct,
      var95,
      level: !riskAllowed ? 'HIGH' : volatilityPct > 4 ? 'MEDIUM' : 'LOW',
      allowed: riskAllowed,
      reason: riskAllowed ? '✓ RISK GATE OPEN' : (!liveRiskCheck.allowed ? `BOT RISK: ${liveRiskCheck.reason || 'BLOCKED'}` : volatilityPct > 6 ? 'Volatility > 6%' : 'Sharpe < 0.5')
    },
    decision: {
      action, approvals,
      confidence,
      reason,
      eventId: ++dashboardEventCounter
    },
    marketPhase: currentMarketPhase,
    activeTrades: activeTrades.size,
    ticker: `LIVE ${symbol} · KuCoin Futures · ${new Date().toISOString()}`
  };
  dashboardCache.set(symbol, { ts: Date.now(), data });
  return data;
}

app.get('/dashboard', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(require('node:path').join(__dirname, 'dashboard.html'));
});

app.get('/api/dashboard/build', (req, res) => {
  res.json({ build: 'JARVIS-NEURAL-BRAIN-6.12-PRODUCTION-LINK', runtime: 'v25', dashboard: 'unified', timestamp: Date.now(), modules: ['live-market','agent-neural-layer','supervisor','execution','portfolio','rl-learning','event-bus','historical-replay','walk-forward-oos','monte-carlo','attribution','regime-intelligence','adaptive-router','counterfactual','coin-forensics-outcomes','mfe-mae-forward-horizons','production-scanner-live-bridge','scan-history-api','3d-neural-brain','decision-to-outcome-graph'] });
});

app.get('/api/dashboard/live', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC-USDT').toUpperCase();
    if (!/^[A-Z0-9]+-USDT$/.test(symbol)) return res.status(400).json({ error: 'INVALID_SYMBOL' });
    const data = await getDashboardData(symbol);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    logger.warn(`[Dashboard] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});



async function getDashboardAgentNetwork(symbol) {
  const data = await getDashboardData(symbol);
  const candles = data.candles || [];
  const book = data.market?.orderBook || {};
  const contract = data.market?.contract || {};
  const closes = candles.map(c => Number(c.close)).filter(Number.isFinite);
  const currentPrice = Number(data.market?.price || closes.at(-1) || 0);
  const direction = Number(data.technical?.macd?.histogram || 0) >= 0 ? 'LONG' : 'SHORT';
  const adx = calculateADX(candles, 14);
  const hurst = calculateHurstExponent(closes);
  const atr = calculateATR(candles, 14);
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  const relativeVolume = calculateRelativeVolume(candles, 20);
  const trend1h = data.technical?.trend === 'BULLISH' ? 'BULLISH' : data.technical?.trend === 'BEARISH' ? 'BEARISH' : 'NEUTRAL';
  const trend4h = trend1h;
  const signalScore = calculateSignalScore({
    adx, rsi: Number(data.technical?.rsi || 50), relativeVolume,
    trend1h, trend4h, direction, marketPhase: currentMarketPhase,
    macdHistogram: Number(data.technical?.macd?.histogram || 0)
  });
  let mlProbability = 0.5;
  try {
    const mlFeatures = buildMLFeatures({
      adx, rsi: Number(data.technical?.rsi || 50), relativeVolume, signalScore, atrPct,
      hurst, macdHistogramPct: currentPrice ? (Number(data.technical?.macd?.histogram || 0) / currentPrice) * 100 : 0,
      pocDistancePct: 0, vwapDistancePct: 0, fundingRate: Number(contract.fundingRate || 0),
      openInterest: Number(contract.openInterest || 0), trend4h, trend1h, trend15m: trend1h,
      btcTrend: trend1h, direction, marketPhase: currentMarketPhase,
      orderBookImbalance: Number(book.bidAskRatio || 1), spreadPct: Number(book.spreadPct || 0), volatilityRatio: 1
    });
    const ml = predictSignalSuccess(mlFeatures);
    if (Number.isFinite(ml?.probability)) mlProbability = Number(ml.probability);
  } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }

  const equity = config.CAPITAL_USD + dailyNetPnL;
  const gross = [...activeTrades.values()].reduce((sum, t) => sum + Math.abs(Number(t.notionalUSD || 0)), 0);
  const exposurePct = gross / Math.max(equity, 1) * 100;
  const liveRiskCheck = riskEngine.assess({ equity, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions: [...activeTrades.values()] });
  const agentEvaluation = agentSuite.evaluate({
    symbol, direction,
    spreadPct: Number(book.spreadPct || 0),
    depthUSD: Number(book.depthUSD || contract.volume24h || data.market?.volume24h || 0),
    orderSizeUSD: Math.max(1, currentPrice * 0.001),
    apiLatencyMs: apiLatencyStats.getAverage('kucoin'),
    candleDelayMs: Math.max(0, Date.now() - new Date(candles.at(-1)?.time || Date.now()).getTime()),
    exposurePct,
    maxExposurePct: Math.max(0, Number(config.MAX_EXPOSURE_RATIO || 0)) * Math.max(1, Number(config.LEVERAGE || 1)) * 100,
    drawdownPct: Math.max(0, data.risk?.drawdownPct || 0),
    maxDrawdownPct: MAX_DRAWDOWN_PERCENT,
    dailyLossPct: Math.max(0, -(dailyNetPnL / Math.max(config.CAPITAL_USD, 1)) * 100),
    maxDailyLossPct: Math.max(0, Number(config.MAX_DAILY_LOSS_USD || 0) / Math.max(config.CAPITAL_USD, 1) * 100),
    killSwitch: safetyController.isActive('kill-switch') || isPaused,
    circuitBreaker: Date.now() < kucoinCircuitOpenUntil,
    regime: { confidence: currentMarketPhase === 'RANGING' || currentMarketPhase === 'TRENDING' ? 0.75 : 0.5 },
    expectancy: 0,
    sharpe: Number(data.risk?.sharpe || 0),
    maxDrawdownPct: Math.abs(Number(data.risk?.drawdownPct || 0)),
    oosScore: Number(mlModel.getStats().validationAccuracy || 0),
    driftScore: Number(modelDriftMonitor.status().score || 0),
    assets: [{ symbol, requestedWeightPct: Math.min(100, Math.max(0, exposurePct)) }]
  });

  let dqn = { enabled: Boolean(config.DQN_ENABLED), initialized: Boolean(dqnAgent.isInitialized), action: 'UNAVAILABLE', actionIndex: null, qValues: null, epsilon: null, modelVersion: null };
  if (config.DQN_ENABLED && dqnAgent.isInitialized) {
    const state = buildDQNStateVector({
      adx, rsi: Number(data.technical?.rsi || 50), hurst, relativeVolume, signalScore,
      direction, marketPhase: currentMarketPhase, atrPct, pocDistancePct: 0, vwapDistancePct: 0,
      orderBookImbalance: Number(book.bidAskRatio || 1), spreadPct: Number(book.spreadPct || 0), volatilityRatio: 1,
      mlProbability
    });
    const previousEpsilon = dqnAgent.epsilon;
    try {
      // Observation-only: force exploitation for the dashboard and restore epsilon immediately.
      dqnAgent.epsilon = 0;
      const meta = dqnAgent.actWithMetadata(state);
      dqn = { enabled: true, initialized: true, action: meta.actionName, actionIndex: meta.action, qValues: meta.qValues, epsilon: previousEpsilon, modelVersion: meta.modelVersion, exploration: false };
    } catch (_) {
      dqn = { ...dqn, epsilon: previousEpsilon, modelVersion: dqnAgent.modelVersion };
    } finally { dqnAgent.epsilon = previousEpsilon; }
  }

  const nodes = [
    { id:'risk-supervisor', label:'RISK SUPERVISOR', score:agentEvaluation.riskSupervisor.score, decision:agentEvaluation.riskSupervisor.decision, status:agentEvaluation.riskSupervisor.hardBlock?'BLOCK':'PASS', color:agentEvaluation.riskSupervisor.hardBlock?'red':'green' },
    { id:'portfolio-allocation', label:'PORTFOLIO', score:Math.min(1, Number(agentEvaluation.portfolioAllocation.scale || 0)), decision:'ALLOCATE', status:'PASS', color:'cyan' },
    { id:'anomaly-detection', label:'ANOMALY', score:1-Number(agentEvaluation.anomaly.score || 0), decision:agentEvaluation.anomaly.severity, status:agentEvaluation.anomaly.severity==='HIGH'?'VETO':'PASS', color:agentEvaluation.anomaly.severity==='HIGH'?'red':'green' },
    { id:'liquidity', label:'LIQUIDITY', score:agentEvaluation.liquidity.score, decision:agentEvaluation.liquidity.decision, status:agentEvaluation.liquidity.decision==='BLOCK'?'VETO':'PASS', color:agentEvaluation.liquidity.decision==='BLOCK'?'red':'green' },
    { id:'exit-evaluation', label:'EXIT EVALUATOR', score:agentEvaluation.exit.score, decision:agentEvaluation.exit.decision, status:'MONITOR', color:'gold' },
    { id:'strategy-evaluation', label:'STRATEGY', score:agentEvaluation.strategy.score, decision:agentEvaluation.strategy.health, status:agentEvaluation.strategy.health==='DISABLED'?'VETO':'PASS', color:agentEvaluation.strategy.health==='DISABLED'?'red':'green' },
    { id:'dqn', label:'DQN / RL CORE', score:dqn.qValues ? (Math.max(...dqn.qValues)-Math.min(...dqn.qValues) > 0 ? (Math.max(...dqn.qValues)-Math.min(...dqn.qValues) > 1 ? 1 : .75) : .5) : .5, decision:dqn.action, status:dqn.initialized?'LIVE':'OFFLINE', color:dqn.initialized?'gold':'red' },
    { id:'meta-supervisor', label:'META SUPERVISOR', score:agentEvaluation.meta.confidence, decision:agentEvaluation.meta.decision, status:agentEvaluation.meta.hardBlock?'VETO':'PASS', color:agentEvaluation.meta.hardBlock?'red':'gold' }
  ];
  const consensus = nodes.filter(n => ['PASS','LIVE','MONITOR'].includes(String(n.status))).length;
  const vetoes = nodes.filter(n => String(n.status).includes('VETO') || String(n.status).includes('BLOCK')).map(n => ({ agent: n.label, reason: n.decision }));
  const confidence = Math.round(Math.max(0, Math.min(1, (Number(agentEvaluation.meta.confidence || 0) * 0.55) + (mlProbability * 0.25) + ((consensus / Math.max(1, nodes.length)) * 0.20))) * 100);
  const finalAction = vetoes.length ? 'VERWERFEN' : (dqn.action === 'SELL' || dqn.action === 'SHORT' ? 'VERKAUFEN' : dqn.action === 'BUY' || dqn.action === 'LONG' ? 'KAUFEN' : agentEvaluation.meta.decision || 'MONITOR');
  const replay = { timestamp: Date.now(), symbol, direction, action: finalAction, confidence, consensus, totalAgents: nodes.length, vetoes, marketPhase: currentMarketPhase, dqnAction: dqn.action, mlProbability, riskLevel: data.risk?.level || 'UNKNOWN' };
  pushDashboardReplay(replay);
  jarvisEventBus.emitEvent('AGENTS:EVALUATED', { symbol, nodes, dqn, confidence, consensus, vetoes, finalAction }, { source: 'agent-suite', severity: vetoes.length ? 'WARN' : 'INFO', persist: false, persistReplay: true });
  jarvisEventBus.emitEvent('RISK:EVALUATED', { symbol, allowed: liveRiskCheck.allowed, level: liveRiskCheck.level, reason: liveRiskCheck.reason, equity, exposurePct }, { source: 'risk-engine', severity: liveRiskCheck.allowed ? 'INFO' : 'WARN', persist: !liveRiskCheck.allowed, persistReplay: true, persistMinIntervalMs: 0 });
  return { timestamp: Date.now(), symbol, direction, nodes, dqn, meta: agentEvaluation.meta, confidence, consensus, vetoes, finalAction, raw: agentEvaluation };
}


// ---------------------------------------------------------------------------
// JARVIS AUTONOMOUS SUPERVISOR 3.0
// Read-only supervisory layer: correlates the existing agent network, market
// intelligence, portfolio/risk state and DQN observation. It NEVER submits
// orders and cannot promote models. The output is an explainable governance
// decision for the dashboard.
// ---------------------------------------------------------------------------
const dashboardSupervisorCache = { ts: 0, key: '', data: null };

function dashboardSupervisorClassify(nodes, market, portfolio) {
  const vetoes = [];
  const warnings = [];
  const passes = [];
  for (const n of (nodes || [])) {
    const status = String(n.status || '').toUpperCase();
    const decision = String(n.decision || '').toUpperCase();
    if (status.includes('VETO') || status.includes('BLOCK') || decision.includes('BLOCK')) {
      vetoes.push({ agent: n.label || n.id, reason: n.decision || status, score: Number(n.score || 0) });
    } else if (status === 'MONITOR' || status === 'OFFLINE') {
      warnings.push({ agent: n.label || n.id, reason: n.decision || status, score: Number(n.score || 0) });
    } else {
      passes.push({ agent: n.label || n.id, decision: n.decision || status, score: Number(n.score || 0) });
    }
  }
  const breadth = Number(market?.breadth?.pctBullish ?? market?.breadth ?? 50);
  const avgChange = Number(market?.avgChange ?? 0);
  const riskLevel = String(portfolio?.portfolio?.risk?.level || portfolio?.risk?.level || 'UNKNOWN').toUpperCase();
  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') warnings.push({ agent:'PORTFOLIO RISK', reason:riskLevel, score:0 });
  if (breadth < 30 || breadth > 70) warnings.push({ agent:'MARKET BREADTH', reason: breadth < 30 ? 'BEARISH BREADTH' : 'BULLISH BREADTH', score:Math.min(1, Math.abs(breadth-50)/50) });
  if (Math.abs(avgChange) > 4) warnings.push({ agent:'MARKET VOLATILITY', reason:'EXTREME MARKET MOVE', score:1 });
  return { vetoes, warnings, passes };
}

async function getDashboardAutonomousSupervisor(symbol) {
  const key = String(symbol || 'BTC-USDT').toUpperCase();
  const now = Date.now();
  if (dashboardSupervisorCache.data && dashboardSupervisorCache.key === key && now - dashboardSupervisorCache.ts < 3000) return dashboardSupervisorCache.data;
  const [agents, market, portfolio] = await Promise.all([
    getDashboardAgentNetwork(key),
    getDashboardMarketOverview(),
    getDashboardPortfolioLearning()
  ]);
  const classified = dashboardSupervisorClassify(agents.nodes, market, portfolio);
  const total = Math.max(1, agents.nodes.length);
  const consensusPct = Math.round((classified.passes.length / total) * 100);
  const hardBlock = classified.vetoes.length > 0;
  const warnings = classified.warnings.length;
  const action = hardBlock ? 'BLOCK' : (warnings >= 3 ? 'HOLD / MONITOR' : agents.finalAction);
  const confidence = Math.max(0, Math.min(100, Math.round(Number(agents.confidence || 0) * (hardBlock ? 0.45 : warnings ? 0.78 : 1))));
  const conflicts = [];
  const dqnAction = String(agents.dqn?.action || 'UNAVAILABLE').toUpperCase();
  const finalAction = String(agents.finalAction || 'MONITOR').toUpperCase();
  if (dqnAction !== 'UNAVAILABLE' && ((dqnAction === 'BUY' && finalAction === 'VERKAUFEN') || (dqnAction === 'SELL' && finalAction === 'KAUFEN'))) {
    conflicts.push({ type:'DQN_VS_DECISION', severity:'HIGH', reason:`DQN ${dqnAction} conflicts with final ${finalAction}` });
  }
  if (classified.vetoes.length) conflicts.push(...classified.vetoes.map(v => ({ type:'AGENT_VETO', severity:'HIGH', reason:`${v.agent}: ${v.reason}` })));
  if (warnings) conflicts.push(...classified.warnings.map(w => ({ type:'SUPERVISOR_WARNING', severity:'MEDIUM', reason:`${w.agent}: ${w.reason}` })));
  const governance = {
    executionAllowed: false,
    liveOrders: false,
    modelPromotionAllowed: false,
    recommendation: action,
    reason: hardBlock ? classified.vetoes.map(v=>`${v.agent}: ${v.reason}`).join(' | ') : warnings ? `${warnings} supervisory warning(s); observe before execution.` : 'Agent consensus clean; execution remains gated by existing safety controls.'
  };
  const result = {
    timestamp: now,
    symbol: key,
    supervisor: { status:'ONLINE', mode:'READ_ONLY_GOVERNANCE', recommendation:action, confidence, consensusPct, hardBlock, governance },
    conflicts,
    counts: { agents:total, pass:classified.passes.length, veto:classified.vetoes.length, warnings },
    agents: agents.nodes,
    dqn: agents.dqn,
    meta: agents.meta,
    market: { breadth: market?.breadth, avgChange: market?.avgChange, gainers: market?.gainers, losers: market?.losers, volume24h: market?.volume24h },
    portfolio: portfolio?.portfolio || {},
    explanations: {
      vetoes: classified.vetoes,
      warnings: classified.warnings,
      passes: classified.passes,
      finalDecision: agents.finalAction,
      decisionPath: ['MARKET INTELLIGENCE','AGENT CONSENSUS','DQN OBSERVATION','PORTFOLIO/RISK','META SUPERVISOR','EXECUTION GATE (LOCKED)']
    }
  };
  dashboardSupervisorCache.ts = now; dashboardSupervisorCache.key = key; dashboardSupervisorCache.data = result;
  jarvisEventBus.emitEvent('SUPERVISOR:EVALUATED', { symbol: key, recommendation: action, confidence, consensusPct, hardBlock, conflicts, decisionPath: result.explanations.decisionPath }, { source: 'autonomous-supervisor', severity: hardBlock ? 'HIGH' : conflicts.length ? 'WARN' : 'INFO', persist: hardBlock || conflicts.length > 0, persistReplay: true, persistMinIntervalMs: 0 });
  return result;
}

app.get('/api/dashboard/agents', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTC-USDT').toUpperCase();
    if (!/^[A-Z0-9]+-USDT$/.test(symbol)) return res.status(400).json({ error: 'INVALID_SYMBOL' });
    const data = await getDashboardAgentNetwork(symbol);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    logger.warn(`[Dashboard Agents] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/dashboard/supervisor', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || dashboardScanUniverse[0] || 'BTC-USDT').toUpperCase();
    if (!/^[A-Z0-9]+-USDT$/.test(symbol)) return res.status(400).json({ error: 'INVALID_SYMBOL' });
    const data = await getDashboardAutonomousSupervisor(symbol);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    logger.warn(`[Dashboard Supervisor] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/dashboard/connection', (req, res) => {
  const rows = dashboardLiveScannerRows();
  res.setHeader('Cache-Control','no-store');
  const newestTs = rows.reduce((max, r) => Math.max(max, Number(r?.eventTs || 0)), 0);
  const ageMs = newestTs ? Math.max(0, Date.now() - newestTs) : null;
  const live = rows.length > 0 && ageMs !== null && ageMs <= Math.max(15000, Number(config.LOCK_STALE_AFTER_MS || 90000));
  res.json({
    connected: live,
    source: live ? 'PRODUCTION_SCANNER_EVENT_BUS' : 'WAITING_FOR_PRODUCTION_SCANNER',
    eventBus: jarvisEventBus.snapshot(),
    scanner: { ...dashboardScanState, universe: dashboardScanUniverse, lastLiveScanCounter: dashboardLastLiveScanCounter },
    lastEventTs: newestTs || null,
    ageMs,
    liveCoins: rows.map(r => ({ symbol:r.symbol, eventTs:r.eventTs, ageMs:Math.max(0,Date.now()-Number(r.eventTs||Date.now())), scanStatus:r.scanStatus||'EVALUATED' }))
  });
});

app.get('/api/dashboard/live-scanner', (req, res) => {
  const rows = dashboardLiveScannerRows().map(r => ({
    ...r, ageMs: Math.max(0, Date.now() - Number(r.eventTs || r.timestamp || Date.now())),
    live: true
  }));
  res.setHeader('Cache-Control','no-store');
  res.json({ timestamp: Date.now(), source: 'PRODUCTION_SCANNER', scan: { ...dashboardScanState, universe: dashboardScanUniverse, lastLiveScanCounter: dashboardLastLiveScanCounter }, rows });
});

app.get('/api/dashboard/market-overview', async (req, res) => {
  try {
    const data = await getDashboardMarketOverview();
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    logger.warn(`[Dashboard Market Overview] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/dashboard/scan', async (req, res) => {
  try {
    const data = await getDashboardScanMatrix();
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    logger.warn(`[Dashboard Scan] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});

app.get('/api/dashboard/intelligence', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || dashboardScanUniverse[0] || 'BTC-USDT').toUpperCase();
    const [market, agents] = await Promise.all([getDashboardData(symbol), getDashboardAgentNetwork(symbol)]);
    const mlStats = mlModel.getStats();
    const dqnStats = dqnAgent.getStats();
    const drift = modelDriftMonitor.status();
    const readiness = dashboardReadinessSnapshot();
    const performance = dashboardAgentPerformance();
    const replay = dashboardDecisionReplay.slice(0, 80);
    const current = {
      symbol, timestamp: Date.now(), marketPhase: dashboardRegimeSnapshot(),
      regime: dashboardRegimeSnapshot(),
      macro: { value: market.sentiment?.value ?? null, classification: market.sentiment?.classification ?? null, bias: market.sentiment?.bias ?? null, allowed: market.sentiment?.allowed ?? null },
      confidence: agents.confidence, consensus: agents.consensus, vetoes: agents.vetoes, finalAction: agents.finalAction,
      activeTrades: activeTrades.size, dailyPnL: dailyNetPnL, equity: config.CAPITAL_USD + dailyNetPnL,
      risk: market.risk, agents: agents.nodes,
      dqn: { ...dqnStats, action: agents.dqn?.action, qValues: agents.dqn?.qValues },
      ml: { validationAccuracy: mlStats.validationAccuracy, stats: mlStats },
      drift,
      execution: readiness.execution
    };
    res.setHeader('Cache-Control','no-store');
    res.json({ timestamp: Date.now(), current, replay, performance, readiness, scanner: { ...dashboardScanState, universe: dashboardScanUniverse, intervalMs: Number(config.SCAN_INTERVAL_MS || config.SCAN_INTERVAL || 0) || null }, regime: dashboardRegimeSnapshot() });
  } catch (e) {
    logger.warn(`[Dashboard Intelligence] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});

async function getDashboardExecutionPortfolio(symbol) {
  const now = Date.now();
  const readiness = dashboardReadinessSnapshot();
  const open = [...activeTrades.entries()];
  const equity = Number(config.CAPITAL_USD || 0) + Number(dailyNetPnL || 0);
  const positions = [];
  await asyncPool(4, open, async ([sym, trade]) => {
    try {
      const mark = Number(await fetchKucoinMarkPrice(sym) || trade.entry || 0);
      const entry = Number(trade.entry || 0);
      const units = Number(trade.positionSizeUnits || 0);
      const direction = String(trade.direction || 'LONG').toUpperCase();
      const unrealized = (direction === 'LONG' ? mark - entry : entry - mark) * units;
      const notional = Math.abs(Number(trade.notionalUSD || (mark * units) || 0));
      positions.push({
        symbol: sym, direction, entry, mark, units, notionalUSD: notional,
        unrealizedPnL: unrealized, stopLoss: Number(trade.stopLoss || 0),
        tp1: Number(trade.tp1 || 0), tp2: Number(trade.tp2 || 0),
        tp1Hit: Boolean(trade.tp1Hit), openedAt: trade.openTime || trade.entryTime || null,
        source: 'activeTrades'
      });
    } catch (_) {
      positions.push({ symbol: sym, direction: trade.direction, entry: Number(trade.entry || 0), mark: Number(trade.entry || 0), units: Number(trade.positionSizeUnits || 0), notionalUSD: Number(trade.notionalUSD || 0), unrealizedPnL: 0, stopLoss: Number(trade.stopLoss || 0), tp1: Number(trade.tp1 || 0), tp2: Number(trade.tp2 || 0), tp1Hit: Boolean(trade.tp1Hit), openedAt: trade.openTime || trade.entryTime || null, source: 'activeTrades' });
    }
  });
  const gross = positions.reduce((a,p) => a + Math.abs(Number(p.notionalUSD || 0)), 0);
  const longNotional = positions.filter(p => p.direction === 'LONG').reduce((a,p) => a + Math.abs(Number(p.notionalUSD || 0)), 0);
  const shortNotional = positions.filter(p => p.direction === 'SHORT').reduce((a,p) => a + Math.abs(Number(p.notionalUSD || 0)), 0);
  const unrealizedPnL = positions.reduce((a,p) => a + Number(p.unrealizedPnL || 0), 0);
  const concentration = positions.map(p => ({ symbol: p.symbol, pct: gross > 0 ? Math.abs(p.notionalUSD) / gross * 100 : 0 }));
  const maxConcentration = concentration.length ? Math.max(...concentration.map(x => x.pct)) : 0;
  const risk = riskEngine.assess({ equity, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions: positions });
  const latest = dashboardDecisionReplay.find(x => x.symbol === symbol) || null;
  const stages = [
    { key:'scan', label:'SCANNER', status:'COMPLETE', timestamp: latest?.timestamp || now },
    { key:'analysis', label:'NEURAL ANALYSIS', status: latest ? 'COMPLETE' : 'WAITING', timestamp: latest?.timestamp || null },
    { key:'consensus', label:'AGENT CONSENSUS', status: latest ? (latest.vetoes?.length ? 'VETO' : 'APPROVED') : 'WAITING', timestamp: latest?.timestamp || null },
    { key:'risk', label:'RISK GATE', status: risk.allowed ? 'APPROVED' : 'BLOCKED', timestamp: now },
    { key:'execution', label:'EXECUTION GATE', status: readiness.execution?.liveOrders ? 'OPEN' : 'PAPER / SHADOW', timestamp: now },
    { key:'order', label:'ORDER', status: positions.some(p => p.symbol === symbol) ? 'POSITION ACTIVE' : 'NOT SUBMITTED', timestamp: positions.some(p => p.symbol === symbol) ? now : null },
    { key:'position', label:'POSITION', status: positions.some(p => p.symbol === symbol) ? 'OPEN' : 'FLAT', timestamp: positions.some(p => p.symbol === symbol) ? now : null },
    { key:'exit', label:'EXIT', status: positions.some(p => p.symbol === symbol) ? 'MONITORING' : 'WAITING', timestamp: null }
  ];
  const executionSnapshot = { mode: readiness.execution?.paperOnly ? 'PAPER / SHADOW' : (readiness.execution?.liveOrders ? 'LIVE' : 'LOCKED'), ready: Boolean(risk.allowed && !isPaused && Date.now() >= kucoinCircuitOpenUntil), killSwitch: safetyController.isActive('kill-switch') || isPaused, circuitBreaker: Date.now() < kucoinCircuitOpenUntil, reconciliation: readiness.checks?.reconciliationHealthy !== false, lifecycle: stages.map(s => ({ key: s.key, status: s.status })) };
  jarvisEventBus.emitEvent('EXECUTION:STATE', { symbol, ...executionSnapshot }, { source: 'execution-governance', severity: executionSnapshot.ready ? 'INFO' : 'WARN', persist: true, persistReplay: true, persistMinIntervalMs: 0 });
  jarvisEventBus.emitEvent('PORTFOLIO:SNAPSHOT', { symbol, equity, grossExposureUSD: gross, longNotionalUSD: longNotional, shortNotionalUSD: shortNotional, unrealizedPnL, openPositions: positions.length, maxConcentrationPct: maxConcentration }, { source: 'portfolio', persist: false });
  return {
    timestamp: now,
    symbol,
    execution: {
      mode: readiness.execution?.paperOnly ? 'PAPER / SHADOW' : (readiness.execution?.liveOrders ? 'LIVE' : 'LOCKED'),
      liveOrders: Boolean(readiness.execution?.liveOrders),
      ready: Boolean(risk.allowed && !isPaused && Date.now() >= kucoinCircuitOpenUntil),
      gateReason: risk.allowed ? 'RISK APPROVED' : (risk.reason || 'RISK BLOCKED'),
      reconciliation: readiness.checks?.reconciliationHealthy !== false,
      killSwitch: safetyController.isActive('kill-switch') || isPaused,
      circuitBreaker: Date.now() < kucoinCircuitOpenUntil
    },
    lifecycle: stages,
    latestDecision: latest,
    positions,
    portfolio: {
      equity, dailyPnL: Number(dailyNetPnL || 0), unrealizedPnL, grossExposureUSD: gross,
      exposurePct: equity > 0 ? gross / equity * 100 : 0,
      longNotionalUSD: longNotional, shortNotionalUSD: shortNotional,
      netDirectionalUSD: longNotional - shortNotional,
      openPositions: positions.length, maxConcurrent: Number(config.MAX_CONCURRENT_TRADES || 0),
      maxConcentrationPct: maxConcentration,
      concentration, risk
    }
  };
}

app.get('/api/dashboard/execution', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || dashboardScanUniverse[0] || 'BTC-USDT').toUpperCase();
    if (!/^[A-Z0-9]+-USDT$/.test(symbol)) return res.status(400).json({ error: 'INVALID_SYMBOL' });
    const data = await getDashboardExecutionPortfolio(symbol);
    res.setHeader('Cache-Control','no-store');
    res.json(data);
  } catch (e) {
    logger.warn(`[Dashboard Execution] ${e.message}`);
    res.status(503).json({ error: e.message });
  }
});


app.get('/api/dashboard/portfolio-learning', async (req, res) => {
  try { res.json(await getDashboardPortfolioLearning()); }
  catch (error) { res.status(503).json({ error:'PORTFOLIO_LEARNING_UNAVAILABLE', message:error.message }); }
});

app.get('/api/dashboard/events', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));
  const since = Number(req.query.since || 0);
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  const types = req.query.types ? String(req.query.types).split(',').map(x => x.trim()).filter(Boolean) : null;
  res.setHeader('Cache-Control','no-store');
  res.json({ timestamp: Date.now(), bus: jarvisEventBus.snapshot(), events: jarvisEventBus.recent({ limit, since, symbol, types }) });
});

app.get('/api/dashboard/events/stream', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache, no-transform');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  const send = event => { if (!symbol || event.symbol === symbol || !event.symbol) res.write(`event: jarvis\ndata: ${JSON.stringify(event)}\n\n`); };
  jarvisEventBus.on('event', send);
  res.write(`event: ready\ndata: ${JSON.stringify({ timestamp: Date.now(), bus: jarvisEventBus.snapshot() })}\n\n`);
  // Reconcile immediately with the bot's current in-memory event buffer. This
  // prevents a dashboard opened between scans from appearing disconnected.
  try {
    const replay = jarvisEventBus.recent({ limit: 200, symbol, types: null }).reverse();
    for (const event of replay) send(event);
  } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }
  const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15000);
  req.on('close', () => { clearInterval(heartbeat); jarvisEventBus.off('event', send); });
});

app.get('/api/dashboard/replay', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));
  res.setHeader('Cache-Control','no-store');
  res.json({ timestamp: Date.now(), items: dashboardDecisionReplay.slice(0, limit) });
});

// ============================================================================
// JARVIS 4.0 — HISTORICAL INTELLIGENCE / READ-ONLY REPLAY
// Replays recorded market-data events without touching live execution state.
// ============================================================================
const jarvisHistoricalReplay = new MarketDataReplay({
  dir: process.env.MARKET_DATA_DIR || './data/market-replay',
  speed: 0,
  logger: console
});

app.get('/api/dashboard/coin-timeline', async (req, res) => {
  try {
    const now = Date.now();
    const fromTs = Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : now - 24 * 60 * 60 * 1000;
    const toTs = Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : now;
    const symbol = String(req.query.symbol || dashboardScanUniverse[0] || 'BTC-USDT').toUpperCase();
    const limit = Math.min(300, Math.max(10, Number(req.query.limit || 120)));
    const events = [];
    await jarvisHistoricalReplay.run({ fromTs, toTs, onEvent: async e => {
      if (String(e.symbol || '').toUpperCase() === symbol) events.push(e);
    }});
    const timeline = buildCoinTimeline(events, symbol).slice(-limit);
    const scans = timeline.length;
    const decisions = timeline.filter(x => x.decision).length;
    const passes = timeline.filter(x => String(x.snapshot?.gateStatus || '').toUpperCase() === 'PASS').length;
    const rejects = scans - passes;
    const reactions = timeline.map(x => Number(x.directedReactionPct)).filter(Number.isFinite);
    const avgReaction = reactions.length ? reactions.reduce((a,b)=>a+b,0)/reactions.length : null;
    const positiveReactionRate = reactions.length ? reactions.filter(x=>x>0).length/reactions.length*100 : null;
    res.setHeader('Cache-Control','no-store');
    res.json({
      timestamp: now, mode: 'READ_ONLY_COIN_FORENSICS', symbol,
      range: { from: fromTs, to: toTs },
      summary: { scans, decisions, passes, rejects, avgDirectedReactionPct: avgReaction, positiveReactionRate },
      timeline
    });
  } catch (err) {
    logger.warn(`[Dashboard Coin Timeline] ${err.message}`);
    res.status(500).json({ error: 'COIN_TIMELINE_FAILED', message: err.message });
  }
});

app.get('/api/dashboard/scan-history', async (req, res) => {
  try {
    const now = Date.now();
    const fromTs = Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : now - 24 * 60 * 60 * 1000;
    const toTs = Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : now;
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 1000)));
    const events = [];
    await jarvisHistoricalReplay.run({ fromTs, toTs, onEvent: async e => {
      if (e.type !== 'SCAN:COIN') return;
      if (symbol && String(e.symbol || '').toUpperCase() !== symbol) return;
      events.push(e);
    }});
    events.sort((a,b) => Number(a.ts||0)-Number(b.ts||0));
    const limited = events.slice(-limit);
    res.setHeader('Cache-Control','no-store');
    res.json({ timestamp: now, source:'PRODUCTION_SCANNER_HISTORY', range:{from:fromTs,to:toTs}, symbol, count:limited.length, events:limited });
  } catch (err) {
    logger.warn(`[Dashboard Scan History] ${err.message}`);
    res.status(500).json({ error:'SCAN_HISTORY_FAILED', message:err.message });
  }
});

app.get('/api/dashboard/historical', async (req, res) => {
  try {
    const now = Date.now();
    const defaultFrom = now - 24 * 60 * 60 * 1000;
    const fromTs = Number.isFinite(Number(req.query.from)) ? Number(req.query.from) : defaultFrom;
    const toTs = Number.isFinite(Number(req.query.to)) ? Number(req.query.to) : now;
    const symbol = String(req.query.symbol || '').toUpperCase();
    const limit = Math.min(500, Math.max(20, Number(req.query.limit || 180)));
    const events = [];
    await jarvisHistoricalReplay.run({ fromTs, toTs, onEvent: async (e) => {
      if (symbol && String(e.symbol || '').toUpperCase() !== symbol) return;
      events.push(e);
    }});
    const counts = {}; const bySymbol = {}; let minTs = Infinity, maxTs = -Infinity;
    for (const e of events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
      const sym = String(e.symbol || 'SYSTEM').toUpperCase();
      bySymbol[sym] = (bySymbol[sym] || 0) + 1;
      if (Number.isFinite(e.ts)) { minTs = Math.min(minTs, e.ts); maxTs = Math.max(maxTs, e.ts); }
    }
    const decisionEvents = events.filter(e => /DECISION|SUPERVISOR|AGENTS:EVALUATED/.test(String(e.type)));
    const vetoes = decisionEvents.filter(e => Number(e.payload?.vetoes?.length || 0) > 0).length;
    const actions = {};
    for (const e of decisionEvents) { const a = String(e.payload?.action || e.payload?.finalAction || e.payload?.recommendation || '').toUpperCase(); if (a) actions[a] = (actions[a] || 0) + 1; }
    res.setHeader('Cache-Control','no-store');
    res.json({
      timestamp: now, mode: 'READ_ONLY_HISTORICAL_REPLAY', source: jarvisHistoricalReplay.dir,
      range: { from: fromTs, to: toTs, firstEvent: Number.isFinite(minTs) ? minTs : null, lastEvent: Number.isFinite(maxTs) ? maxTs : null },
      filter: { symbol: symbol || 'ALL' }, totalEvents: events.length, returnedEvents: Math.min(limit, events.length),
      counts, bySymbol, actions, vetoEvents: vetoes,
      events: events.slice(-limit).map(e => ({ ts:e.ts, eventId:e.eventId, seq:e.seq, type:e.type, symbol:e.symbol || null, severity:e.severity || 'INFO', source:e.source || null, payload:e.payload || {} }))
    });
  } catch (err) {
    res.status(500).json({ error: 'HISTORICAL_REPLAY_FAILED', message: err.message });
  }
});


// ============================================================================
// JARVIS 4.5 — WALK-FORWARD / OOS / MONTE-CARLO INTELLIGENCE
// Read-only analytics over recorded market-data events. No live state mutation.
// ============================================================================
const jarvisBacktestCache = { ts: 0, key: '', data: null };
function jarvisHistPrice(e) {
  const p = e?.payload || e?.data || {};
  const candidates = [p.price, p.close, p.last, p.markPrice, p.market?.price, p.market?.close, e?.price];
  for (const v of candidates) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; }
  return null;
}
function jarvisHistAction(e) {
  const p = e?.payload || {};
  return String(p.action || p.finalAction || p.recommendation || p.decision || '').toUpperCase();
}
function jarvisBacktestMetrics(values) {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return { count: 0, totalReturn: 0, winRate: 0, sharpe: 0, maxDrawdown: 0 };
  let eq=1, peak=1, mdd=0, wins=0, sum=0, sq=0;
  for (const r of xs) { eq*=1+r; peak=Math.max(peak,eq); mdd=Math.max(mdd,(peak-eq)/peak); if(r>0)wins++; sum+=r; sq+=r*r; }
  const mean=sum/xs.length, variance=Math.max(0,sq/xs.length-mean*mean);
  return { count:xs.length, totalReturn:(eq-1)*100, winRate:wins/xs.length*100, sharpe:variance>0?mean/Math.sqrt(variance)*Math.sqrt(xs.length):0, maxDrawdown:mdd*100 };
}

app.get('/api/dashboard/backtest-intelligence', async (req, res) => {
  try {
    const now=Date.now(), from=Number.isFinite(Number(req.query.from))?Number(req.query.from):now-7*86400000, to=Number.isFinite(Number(req.query.to))?Number(req.query.to):now;
    const symbol=String(req.query.symbol||'').toUpperCase();
    const trainSize=Math.max(20,Math.min(1000,Number(req.query.trainSize||120)));
    const testSize=Math.max(10,Math.min(500,Number(req.query.testSize||40)));
    const stepSize=Math.max(1,Math.min(500,Number(req.query.stepSize||40)));
    const purgeSize=Math.max(0,Math.min(100,Number(req.query.purgeSize||2)));
    const embargoSize=Math.max(0,Math.min(100,Number(req.query.embargoSize||2)));
    const key=[from,to,symbol,trainSize,testSize,stepSize,purgeSize,embargoSize].join(':');
    if(jarvisBacktestCache.data && jarvisBacktestCache.key===key && now-jarvisBacktestCache.ts<5000) return res.json(jarvisBacktestCache.data);
    const events=[];
    await jarvisHistoricalReplay.run({fromTs:from,toTs:to,onEvent:async e=>{ if(!symbol || String(e.symbol||'').toUpperCase()===symbol) events.push(e); }});
    events.sort((a,b)=>a.ts-b.ts);
    const pricesBySymbol=new Map();
    for(const e of events){const sym=String(e.symbol||'').toUpperCase(); const price=jarvisHistPrice(e); if(!sym||!price)continue; if(!pricesBySymbol.has(sym))pricesBySymbol.set(sym,[]); pricesBySymbol.get(sym).push({ts:e.ts,price});}
    const returns=[];
    for(const [sym,arr] of pricesBySymbol){let prev=null; for(const x of arr){if(prev && x.price>0){returns.push({ts:x.ts,symbol:sym,ret:x.price/prev-1,price:x.price});} prev=x.price;}}
    returns.sort((a,b)=>a.ts-b.ts);
    const series=returns.map(x=>x.ret);
    const splits=splitWalkForward(series,{trainSize,testSize,purgeSize,embargoSize,stepSize});
    const windows=splits.map((w,i)=>({index:i,train:{...jarvisBacktestMetrics(w.train)},test:{...jarvisBacktestMetrics(w.test)},purge:w.purge.length,embargo:w.embargo.length}));
    const oos=jarvisBacktestMetrics(splits.flatMap(w=>w.test));
    const inSample=jarvisBacktestMetrics(splits.flatMap(w=>w.train));
    const degradation=inSample.sharpe-oos.sharpe;
    const mcTrades=returns.slice(-Math.min(500,returns.length)).map((x,i)=>({id:i,netPnl:x.ret*100000}));
    const mc=new MonteCarloEngine({runs:Math.min(3000,Math.max(250,Number(req.query.mcRuns||1000))),seed:42}).run(mcTrades,{initialEquity:100000});
    const actionCounts={}; const decisionEvents=[];
    for(const e of events){const a=jarvisHistAction(e); if(a){actionCounts[a]=(actionCounts[a]||0)+1; if(/BUY|SELL|LONG|SHORT|HOLD/.test(a))decisionEvents.push({ts:e.ts,symbol:e.symbol,action:a});}}
    const result={timestamp:now,mode:'READ_ONLY_BACKTEST_INTELLIGENCE',range:{from,to},filter:{symbol:symbol||'ALL'},dataset:{events:events.length,pricePoints:returns.length,symbols:[...pricesBySymbol.keys()]},configuration:{trainSize,testSize,stepSize,purgeSize,embargoSize,mcRuns:mc.runs},inSample,oos,degradation,windows,monteCarlo:{runs:mc.runs,summary:mc.summary},actions:actionCounts,decisions:decisionEvents.slice(-100),governance:{liveExecutionTouched:false,modelPromotionAllowed:false}};
    jarvisBacktestCache.ts=now; jarvisBacktestCache.key=key; jarvisBacktestCache.data=result; res.setHeader('Cache-Control','no-store'); res.json(result);
  } catch(err){res.status(500).json({error:'BACKTEST_INTELLIGENCE_FAILED',message:err.message,liveExecutionTouched:false});}
});



// ============================================================================
// JARVIS 5.5 — REGIME-AWARE INTELLIGENCE
// Read-only analysis of agent/strategy performance across market regimes.
// ============================================================================
const jarvisRegimeCache = { ts: 0, key: '', data: null };
app.get('/api/dashboard/regime-intelligence', async (req,res)=>{
  try {
    const now=Date.now();
    const from=Number.isFinite(Number(req.query.from))?Number(req.query.from):now-7*86400000;
    const to=Number.isFinite(Number(req.query.to))?Number(req.query.to):now;
    const symbol=String(req.query.symbol||'').toUpperCase();
    const horizon=Math.max(1,Math.min(200,Number(req.query.horizon||20)));
    const key=[from,to,symbol,horizon].join(':');
    if(jarvisRegimeCache.data&&jarvisRegimeCache.key===key&&now-jarvisRegimeCache.ts<5000) return res.json(jarvisRegimeCache.data);
    const events=[];
    await jarvisHistoricalReplay.run({fromTs:from,toTs:to,onEvent:async e=>{if(!symbol||String(e.symbol||'').toUpperCase()===symbol)events.push(e);}});
    events.sort((a,b)=>a.ts-b.ts);
    const data=analyzeRegimeIntelligence(events,horizon);
    data.range={from,to}; data.filter={symbol:symbol||'ALL'}; data.dataset={events:events.length};
    const liveRegime = dashboardRegimeSnapshot();
    data.currentRegime = liveRegime.phase;
    data.phase = liveRegime.phase;
    data.confidence = liveRegime.confidence;
    data.description = liveRegime.description;
    data.live = liveRegime;
    jarvisRegimeCache.ts=now; jarvisRegimeCache.key=key; jarvisRegimeCache.data=data;
    res.setHeader('Cache-Control','no-store'); res.json(data);
  } catch(err){res.status(500).json({error:'REGIME_INTELLIGENCE_FAILED',message:err.message,liveExecutionTouched:false});}
});

// ============================================================================
// JARVIS 5.0 — STRATEGY ATTRIBUTION & AGENT ACCURACY
// Read-only attribution over recorded decision events. No live state mutation.
// ============================================================================
const jarvisAttributionCache = { ts: 0, key: '', data: null };
function jarvisClamp(v,a,b){ return Math.max(a, Math.min(b, Number(v)||0)); }
function jarvisOutcomeReturn(action, entry, exit){
  if(!Number.isFinite(entry)||!Number.isFinite(exit)||entry<=0) return null;
  const r=exit/entry-1; const a=String(action||'').toUpperCase();
  if(/SELL|SHORT|VERKAUF/.test(a)) return -r;
  if(/BUY|LONG|KAUF/.test(a)) return r;
  return null;
}
app.get('/api/dashboard/attribution', async (req,res)=>{
  try {
    const now=Date.now(), from=Number.isFinite(Number(req.query.from))?Number(req.query.from):now-7*86400000;
    const to=Number.isFinite(Number(req.query.to))?Number(req.query.to):now;
    const symbol=String(req.query.symbol||'').toUpperCase();
    const horizon=Math.max(1,Math.min(200,Number(req.query.horizon||20)));
    const key=[from,to,symbol,horizon].join(':');
    if(jarvisAttributionCache.data&&jarvisAttributionCache.key===key&&now-jarvisAttributionCache.ts<5000) return res.json(jarvisAttributionCache.data);
    const events=[];
    await jarvisHistoricalReplay.run({fromTs:from,toTs:to,onEvent:async e=>{if(!symbol||String(e.symbol||'').toUpperCase()===symbol)events.push(e);}});
    events.sort((a,b)=>a.ts-b.ts);
    const bySym=new Map(); for(const e of events){const sym=String(e.symbol||'').toUpperCase();if(!sym)continue;if(!bySym.has(sym))bySym.set(sym,[]);bySym.get(sym).push(e);}
    const decisions=[];
    for(const [sym,arr] of bySym){
      for(let i=0;i<arr.length;i++){
        const e=arr[i]; if(e.type!=='AGENTS:EVALUATED') continue;
        const p=e.payload||{}; const action=String(p.finalAction||'').toUpperCase(); const entry=jarvisHistPrice(e); if(!entry||!action)continue;
        let future=null; let steps=0; for(let j=i+1;j<arr.length&&steps<horizon;j++){const px=jarvisHistPrice(arr[j]);if(px){steps++;future=px;}}
        const outcome=jarvisOutcomeReturn(action,entry,future); if(outcome==null)continue;
        decisions.push({ts:e.ts,symbol:sym,action,entry,exit:future,returnPct:outcome*100,nodes:Array.isArray(p.nodes)?p.nodes:[],vetoes:Array.isArray(p.vetoes)?p.vetoes:[]});
      }
    }
    const agents=new Map();
    for(const d of decisions){for(const n of d.nodes){const name=String(n.label||n.id||'UNKNOWN');if(!agents.has(name))agents.set(name,{agent:name,samples:0,positive:0,avgReturn:0,sum:0,pass:0,veto:0,passSum:0,vetoSum:0,scoreSum:0});const a=agents.get(name);a.samples++;a.sum+=d.returnPct;a.scoreSum+=Number(n.score)||0;if(d.returnPct>0)a.positive++;const veto=/VETO|BLOCK/.test(String(n.status||''));if(veto){a.veto++;a.vetoSum+=d.returnPct}else{a.pass++;a.passSum+=d.returnPct}}}
    const agentRows=[...agents.values()].map(a=>({...a,hitRate:a.samples?a.positive/a.samples*100:0,avgReturn:a.samples?a.sum/a.samples:0,passAvg:a.pass?a.passSum/a.pass:0,vetoAvg:a.veto?a.vetoSum/a.veto:0,avgScore:a.samples?a.scoreSum/a.samples:0})).sort((a,b)=>b.avgReturn-a.avgReturn);
    const actionMap={}; for(const d of decisions){const a=d.action;if(!actionMap[a])actionMap[a]={action:a,samples:0,wins:0,sum:0};actionMap[a].samples++;actionMap[a].sum+=d.returnPct;if(d.returnPct>0)actionMap[a].wins++;}
    const actions=Object.values(actionMap).map(a=>({...a,hitRate:a.samples?a.wins/a.samples*100:0,avgReturn:a.samples?a.sum/a.samples:0}));
    const result={timestamp:now,mode:'READ_ONLY_ATTRIBUTION',range:{from,to},filter:{symbol:symbol||'ALL'},horizon,dataset:{events:events.length,decisions:decisions.length,symbols:[...bySym.keys()]},agents:agentRows,actions,summary:{bestAgent:agentRows[0]?.agent||null,worstAgent:agentRows.at(-1)?.agent||null,decisionHitRate:decisions.length?decisions.filter(d=>d.returnPct>0).length/decisions.length*100:0,avgDecisionReturn:decisions.length?decisions.reduce((s,d)=>s+d.returnPct,0)/decisions.length:0},governance:{readOnly:true,liveExecutionTouched:false,modelPromotionAllowed:false},note:'Attribution uses recorded AGENTS:EVALUATED events and the next observed price within the requested event horizon. It is observational, not causal.'};
    jarvisAttributionCache.ts=now;jarvisAttributionCache.key=key;jarvisAttributionCache.data=result;res.setHeader('Cache-Control','no-store');res.json(result);
  } catch(err){res.status(500).json({error:'ATTRIBUTION_FAILED',message:err.message,liveExecutionTouched:false});}
});


// ============================================================================
// JARVIS 6.0 — ADAPTIVE STRATEGY ROUTER
// Regime-conditioned, read-only weighting recommendation. Never mutates
// strategy configuration and never opens execution.
// ============================================================================
const jarvisRouterCache = { ts:0, key:'', data:null };
app.get('/api/dashboard/adaptive-router', async (req,res)=>{
  try {
    const now=Date.now();
    const symbol=String(req.query.symbol||dashboardScanUniverse[0]||'BTC-USDT').toUpperCase();
    const horizon=Math.max(1,Math.min(200,Number(req.query.horizon||20)));
    const from=Number.isFinite(Number(req.query.from))?Number(req.query.from):now-7*86400000;
    const to=Number.isFinite(Number(req.query.to))?Number(req.query.to):now;
    const key=[symbol,from,to,horizon].join(':');
    if(jarvisRouterCache.data&&jarvisRouterCache.key===key&&now-jarvisRouterCache.ts<5000) return res.json(jarvisRouterCache.data);
    const [agents, supervisor, replay] = await Promise.all([
      getDashboardAgentNetwork(symbol),
      getDashboardAutonomousSupervisor(symbol),
      (async()=>{const events=[];await jarvisHistoricalReplay.run({fromTs:from,toTs:to,onEvent:async e=>{if(!symbol||String(e.symbol||'').toUpperCase()===symbol)events.push(e);}});return events;})()
    ]);
    const regime=String(agents.marketPhase?.phase||supervisor.market?.phase||dashboardRegimeSnapshot()?.phase||'RANGING').toUpperCase();
    const analysis=analyzeRegimeIntelligence(replay,horizon);
    const router=adaptiveStrategyRoute({regime,agents:agents.nodes, historicalAgents:analysis.agents, action:agents.finalAction, governance:{supervisorRecommendation:supervisor.supervisor?.recommendation||'MONITOR'}});
    const result={...router,symbol,range:{from,to},dataset:{events:replay.length,observations:analysis.observations||0},current:{finalAction:agents.finalAction,confidence:agents.confidence,consensus:agents.consensus,dqn:agents.dqn},supervisor:supervisor.supervisor||{}};
    jarvisRouterCache.ts=now;jarvisRouterCache.key=key;jarvisRouterCache.data=result;
    jarvisEventBus.emitEvent('ROUTER:EVALUATED',{symbol,regime,recommendation:router.recommendation,confidence:router.confidence,topAgents:router.topAgents,hardBlock:router.hardBlock},{source:'adaptive-strategy-router',severity:router.hardBlock?'WARN':'INFO',persist:false});
    res.setHeader('Cache-Control','no-store');res.json(result);
  } catch(err){res.status(500).json({error:'ADAPTIVE_ROUTER_FAILED',message:err.message,governance:{executionAllowed:false,liveOrders:false,modelPromotionAllowed:false}});}
});


// ============================================================================
// JARVIS 6.5 — COUNTERFACTUAL DECISION ENGINE
// Read-only scenario comparison: BUY / SELL / MONITOR / BLOCK.
// ============================================================================
app.get('/api/dashboard/counterfactual', async (req,res)=>{
  try {
    const symbol=String(req.query.symbol||dashboardScanUniverse[0]||'BTC-USDT').toUpperCase();
    const [agents, supervisor, router] = await Promise.all([
      getDashboardAgentNetwork(symbol),
      getDashboardAutonomousSupervisor(symbol),
      (async()=>{ const r=await fetch(`http://127.0.0.1:${PORT}/api/dashboard/adaptive-router?symbol=${encodeURIComponent(symbol)}`); return r.json(); })()
    ]);
    const ctx={agents:agents.nodes||[],router,portfolio:agents.portfolio||{},risk:agents.risk||{},dqn:agents.dqn||{},actualAction:agents.finalAction||router.recommendation};
    const result=counterfactualCompare(ctx); result.symbol=symbol;
    result.supervisor={recommendation:supervisor.supervisor?.recommendation||'MONITOR',conflicts:supervisor.supervisor?.conflicts||[]};
    jarvisEventBus.emitEvent('COUNTERFACTUAL:EVALUATED',{symbol,actualAction:result.actualAction,recommendedAction:result.recommendedAction,scenarios:result.scenarios.map(x=>({action:x.action,confidence:x.confidence,hardBlock:x.hardBlock}))},{source:'counterfactual-decision-engine',severity:result.recommendedAction===result.actualAction?'INFO':'WARN',persist:false});
    res.setHeader('Cache-Control','no-store'); res.json(result);
  } catch(err){res.status(500).json({error:'COUNTERFACTUAL_FAILED',message:err.message,governance:{executionAllowed:false,liveOrders:false,modelPromotionAllowed:false}});}
});

app.get('/api/dashboard/historical/status', (req, res) => {
  const fs = require('node:fs');
  const dir = jarvisHistoricalReplay.dir;
  let files = [];
  try { files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort() : []; } catch (_) { logger.warn?.(`[RUNTIME] Best-effort operation failed: ${_.message || _}`); }
  res.json({ timestamp: Date.now(), mode: 'READ_ONLY', directory: dir, available: files.length > 0, files: files.slice(-31), liveExecutionTouched: false });
});


app.get('/api/v24/readiness', (req, res) => {
  const risk = riskEngine.assess({ equity: config.CAPITAL_USD + dailyNetPnL, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions: [...activeTrades.values()] });
  const recon = reconciliationEngine.getStatus ? reconciliationEngine.getStatus() : { healthy: reconciliationEngine.healthy !== false };
  const checks = readinessGate.evaluate({
    apiKeyConfigured: Boolean(config.API_KEY || config.ALLOW_UNAUTHENTICATED_API),
    paperExecution: Boolean(config.PAPER_EXECUTION_ENABLED),
    reconciliationHealthy: recon.healthy !== false,
    dataFeedHealthy: kucoinErrorCount < 3 && Date.now() >= kucoinCircuitOpenUntil,
    riskEngineHealthy: risk.allowed === true,
    oosValidated: Number(mlModel.getStats().validationAccuracy || 0) >= Number(process.env.PRODUCTION_MIN_OOS_ACCURACY || 0.55),
    rollbackReady: Boolean(process.env.MODEL_REGISTRY_DIR || process.env.DQN_REGISTRY_DIR),
    auditTrail: Boolean(auditTrail && auditTrail.file),
    independentOosEvidence: process.env.PRODUCTION_OOS_EVIDENCE === 'true',
    shadowValidated: process.env.SHADOW_VALIDATED === 'true',
    reconciliationDrillPassed: process.env.RECON_DRILL_PASSED === 'true',
    securityReviewApproved: process.env.SECURITY_REVIEW_APPROVED === 'true',
    humanApproval: process.env.HUMAN_APPROVAL === 'true'
  });
  res.status(checks.ready ? 200 : 503).json(checks);
});

app.get('/api/v24/status', (req, res) => {
  res.json({
    version: '24.7.0-agent-suite',
    mode: 'SIGNAL_PAPER_SHADOW',
    liveOrderExecution: false,
    execution: { enabled: false, paperOnly: true, shadowEnabled: true },
    dqn: dqnAgent.getStats(),
    agents: { enabled: true, names: ['risk-supervisor','portfolio-allocation','anomaly-detection','liquidity','exit-evaluation','strategy-evaluation','meta-supervisor'] },
    marketPhase: currentMarketPhase,
    scanCounter,
    lastScanStats,
    safety: safetyController.snapshot(),
    ledger: portfolioLedger.snapshot()
  });
});

app.get('/health', (req, res) => {
  const currentEquity = config.CAPITAL_USD + dailyNetPnL;
  const drawdownPercent = peakCapital > 0 ? ((peakCapital - currentEquity) / peakCapital * 100).toFixed(1) : '0';
  // Liveness must answer 200 while the Node process is alive. Database health is
  // reported as data, not encoded as an HTTP failure, so UptimeRobot does not
  // restart a healthy process merely because MongoDB is temporarily unavailable.
  res.status(200).json({
    status: isDbConnected ? 'ok' : 'degraded',
    liveness: 'ok',
    version: '25.0.0-agent-suite',
    dbConnected: isDbConnected,
    isPaused, activeTrades: activeTrades.size, dailyPnL: dailyNetPnL, currentEquity, peakCapital, drawdownPercent
  });
});

app.get('/ready', async (req, res) => {
  const timesfm = timesFMForecastAgent.getStatus();
  const checks = {
    database: isDbConnected,
    tradingEngine: !isShuttingDown,
    ml: !config.ML_ENABLED || isModelTrained,
    timesfm: !config.TIMESFM_ENABLED || timesfm.ready
  };
  const ready = Object.values(checks).every(Boolean);
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    checks,
    timesfm,
    ml: mlModel.getStats(),
    lastMLTrainingStats
  });
});

app.get('/metrics', (req, res) => {
  const currentEquity = config.CAPITAL_USD + dailyNetPnL;
  const metrics = [
    `# HELP bot_capital Current account capital in USD`,
    `# TYPE bot_capital gauge`,
    `bot_capital ${currentEquity}`,
    `# HELP bot_active_trades Number of currently open trades`,
    `# TYPE bot_active_trades gauge`,
    `bot_active_trades ${activeTrades.size}`,
    `# HELP bot_daily_pnl Daily net profit and loss in USD`,
    `# TYPE bot_daily_pnl gauge`,
    `bot_daily_pnl ${dailyNetPnL}`,
    `# HELP bot_kucoin_errors Current KuCoin circuit breaker error count`,
    `# TYPE bot_kucoin_errors gauge`,
    `bot_kucoin_errors ${kucoinErrorCount}`,
    `# HELP bot_timesfm_requests Total TimesFM requests`,
    `# TYPE bot_timesfm_requests counter`,
    `bot_timesfm_requests ${timesFMForecastAgent.getStatus().requests}`,
    `# HELP bot_timesfm_errors Total TimesFM errors`,
    `# TYPE bot_timesfm_errors counter`,
    `bot_timesfm_errors ${timesFMForecastAgent.getStatus().errors}`,
    `# HELP bot_timesfm_timeouts Total TimesFM timeouts`,
    `# TYPE bot_timesfm_timeouts counter`,
    `bot_timesfm_timeouts ${timesFMForecastAgent.getStatus().timeouts}`
  ].join('\n');
  res.setHeader('Content-Type', 'text/plain');
  res.send(metrics);
});

app.get('/backtest', async (req, res) => {
  if (!config.BACKTEST_API_ENABLED) return res.status(403).json({ error: 'BACKTEST_API_DISABLED' });
  try {
    const symbol = req.query.symbol || 'BTC-USDT';
    const days = Number(req.query.days || 30);
    const cfg = buildBacktestConfig(process.env);
    const useML = req.query.noml !== 'true';

    logger.info(`🚀 Starte Web-Backtest für ${symbol} (${days} Tage)...`);
    const result = await runBacktest({ symbol, days, cfg, useML, walkForward: true });
    res.json(result);
  } catch (e) {
    logger.error(`❌ Web-Backtest Fehler: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/trades', (req, res) => {
  const trades = [...activeTrades.entries()].map(([symbol, trade]) => ({
    symbol, direction: trade.direction, entry: trade.entry, stopLoss: trade.stopLoss, tp1: trade.tp1, tp2: trade.tp2,
    notionalUSD: trade.notionalUSD, tp1Hit: trade.tp1Hit
  }));
  res.json(trades);
});

app.get('/api/performance/week', async (req, res) => {
  const stats = await getPeriodPerformanceStats(7);
  res.json(stats || { error: 'No DB' });
});

app.get('/api/performance/month', async (req, res) => {
  const stats = await getPeriodPerformanceStats(30);
  res.json(stats || { error: 'No DB' });
});

app.get('/api/performance/today', async (req, res) => {
  const stats = await getDailyPerformanceStats();
  res.json(stats || { dailyPnL: dailyNetPnL });
});

app.get('/api/analysis', async (req, res) => {
  const analysis = await getTimeBasedAnalysis();
  res.json(analysis || { error: 'No DB' });
});

app.get('/api/quant/status', (req, res) => {
  const openPositions = [...activeTrades.values()];
  const risk = riskEngine.assess({ equity: config.CAPITAL_USD + dailyNetPnL, peakEquity: peakCapital, dailyPnL: dailyNetPnL, openPositions });
  res.json({
    phase: 'B5-B8',
    executionParity: { enabled: true, fees: true, slippage: true, spread: true, latency: true },
    riskEngine: risk,
    walkForward: { trainDays: config.BACKTEST_TRAIN_DAYS, testDays: config.BACKTEST_TEST_DAYS, purgeDays: config.BACKTEST_PURGE_DAYS, embargoDays: config.BACKTEST_EMBARGO_DAYS },
    ml: { enabled: config.ML_ENABLED, trained: isModelTrained },
    dqn: dqnAgent.getStats(),
    liveExecution: false
  });
});

app.get('/api/ml/status', (req, res) => {
  res.json({
    enabled: config.ML_ENABLED,
    trained: isModelTrained,
    ...mlModel.getStats(),
    dqn: dqnAgent.getStats()
  });
});

const server = app.listen(config.PORT, '0.0.0.0', () => { 
  logger.info(`🌐 Webserver bindet sich an Port ${config.PORT} für Render...`); 
});

// ==========================================
// 19. TIMERS & SHUTDOWN
// ==========================================
const cronJobs = [];
const intervalTimers = [];
let executionLeaseHeartbeat = null;


intervalTimers.push(setInterval(async () => {
  try { await checkActiveTrades(); }
  catch (e) { logger.error(`[TRACKER INTERVAL ERROR] ${e.message}\n${e.stack}`); }
}, config.FAST_TRACK_INTERVAL_SECONDS * 1000));

intervalTimers.push(setInterval(() => {
  try { klinesCache.cleanup(config.CACHE_CLEANUP_MINUTES * 60 * 1000); }
  catch (e) { logger.error(`[CACHE CLEANUP ERROR] ${e.message}`); }
}, config.CACHE_CLEANUP_MINUTES * 60 * 1000));

cronJobs.push(cron.schedule('59 23 * * *', async () => {
  try {
    dailyNetPnL = 0;
    currentStreak = 0;
    await persistDailyPnLState();
  } catch (e) {
    logger.error(`[DAILY RESET CRON ERROR] ${e.message}\n${e.stack}`);
  }
}, { timezone: 'UTC' }));

let lastMLTrainingAttemptAt = 0;
let mlTrainingInProgress = false;

async function runMLTrainingSafely(force = false, source = 'unknown') {
  if (mlTrainingInProgress) {
    logger.info(`🧠 [TensorFlow.js ML] Training übersprungen: bereits aktiv source=${source}`);
    return { trained: false, skipped: true, reason: 'training-in-progress' };
  }
  // Never let scheduled ML work contend with the market scanner.
  if (isScanning) {
    logger.info(`🧠 [TensorFlow.js ML] Training verschoben: Scan aktiv source=${source}`);
    return { trained: false, skipped: true, reason: 'scan-in-progress' };
  }
  mlTrainingInProgress = true;
  try {
    return await trainSignalMLModel(force);
  } finally {
    mlTrainingInProgress = false;
  }
}

cronJobs.push(cron.schedule('0 * * * *', async () => {
  try {
    const intervalMs = Math.max(1, Number(config.ML_RETRAIN_HOURS || 6)) * 60 * 60 * 1000;
    const due = !lastMLTrainingAttemptAt || (Date.now() - lastMLTrainingAttemptAt >= intervalMs);
    // Wenn noch kein Modell existiert, sofort bei jedem stündlichen Tick erneut
    // versuchen. Das verhindert, dass ein temporärer DB-/Datenzustand das Lernen
    // für bis zu 6 Stunden blockiert.
    if (!isModelTrained || due) {
      if (isScanning) {
        logger.info('🧠 [TensorFlow.js ML] Geplantes Training verschoben: Scanner hat Priorität.');
        return;
      }
      lastMLTrainingAttemptAt = Date.now();
      await loadFuturesContractSpecs();
      const result = await runMLTrainingSafely(!isModelTrained, 'cron');
      if (!result.trained && !result.skipped) logger.warn(`🧠 [TensorFlow.js ML] Kein neues Modell: ${result.reason}`);
    }
  } catch (e) {
    logger.error(`[ML CRON ERROR] ${e.message}\n${e.stack}`);
  }
}, { timezone: 'UTC' }));


async function runExecutionRecovery() {
  if (!db || !isDbConnected || !executionCoreReady) {
    global.reconciliationHealthy = false;
    isPaused = true;
    logger.error?.('[RECOVERY] prerequisites unavailable; trading remains paused');
    return;
  }

  try {
    const executionRepository = {
      async findByStates(states) {
        return db.collection('executionIntents')
          .find({ status: { $in: states } })
          .sort({ createdAt: 1 })
          .limit(500)
          .toArray();
      }
    };

    const { ReconciliationEngine: StartupReconciliationEngine } =
      await import('./execution-core/reconciliation-engine.mjs');

    // Current system is intentionally paper-only. The paper adapter is the
    // authoritative remote ledger for paper mode. A future account-enabled
    // exchange adapter can be supplied here without changing the recovery flow.
    const mode = String(process.env.EXECUTION_MODE || (config.PAPER_EXECUTION_ENABLED ? 'paper' : 'shadow')).toLowerCase();
    const reconciliationAdapter = mode === 'paper'
      ? {
          name: 'paper-execution-ledger',
          async getReconciliationSnapshot() {
            return {
              ok: true,
              source: 'paper-execution-adapter',
              openOrders: paperExecutionAdapter.getOrders().filter(o => !['FILLED', 'CANCELLED', 'REJECTED'].includes(String(o.status || '').toUpperCase())),
              fills: paperExecutionAdapter.getOrders().filter(o => Number(o.filledQty || o.quantity || 0) > 0),
              positions: paperExecutionAdapter.getPositions(),
              balances: [{ asset: 'PAPER_USD', available: Number(config.CAPITAL_USD || 0) }]
            };
          },
          async getOrderStatus({ clientOrderId, exchangeOrderId }) {
            const orders = paperExecutionAdapter.getOrders();
            const order = orders.find(o =>
              o.orderId === exchangeOrderId ||
              o.clientOrderId === clientOrderId ||
              o.signalId === clientOrderId
            );
            if (!order) return null;
            return order;
          }
        }
      : global.exchange || global.exchangeClient || null;

    if (!reconciliationAdapter) {
      throw new Error('RECONCILIATION_ADAPTER_UNAVAILABLE');
    }

    const startupEngine = new StartupReconciliationEngine({
      exchange: reconciliationAdapter,
      executionStore: {
        async setState(executionId, state, remote) {
          const doc = await db.collection('executionIntents').findOne({ executionId });
          if (!doc) throw new Error(`EXECUTION_INTENT_NOT_FOUND:${executionId}`);
          await db.collection('executionIntents').updateOne(
            {
              executionId,
              fencingToken: { $lte: Number(currentFencingToken || 0) },
              version: Number(doc.version || 0)
            },
            {
              $set: {
                status: state,
                remote,
                reconciledAt: new Date(),
                fencingToken: Number(currentFencingToken || 0)
              },
              $inc: { version: 1 }
            }
          );
        }
      },
      logger
    });

    const unknownExecutions = await executionRepository.findByStates([
      'ORDER_SUBMITTING',
      'UNKNOWN',
      'RECONCILING'
    ]);

    const internalPositions = [...activeTrades.values()].map(trade => ({
      symbol: trade.symbol,
      direction: trade.direction,
      quantity: Number(trade.positionSizeUnits || trade.quantity || 0),
      positionSizeUnits: Number(trade.positionSizeUnits || trade.quantity || 0),
      source: 'activeTrades'
    }));

    const result = await startupEngine.startupReconcile({
      internalPositions,
      unknownExecutions
    });

    global.reconciliationHealthy = result.ok === true;
    global.reconciliationStatus = result;

    if (!result.ok) {
      isPaused = true;
      logger.error?.(`[RECOVERY] STARTUP RECONCILIATION HALT: ${result.reason || 'ledger mismatch'}`);
      return;
    }

    logger.info?.(`[RECOVERY] STARTUP RECONCILIATION PASS source=${result.source} openOrders=${result.openOrders?.length || 0} fills=${result.fills?.length || 0}`);
  } catch (err) {
    global.reconciliationHealthy = false;
    global.reconciliationStatus = { ok: false, phase: 'HALT', reason: err.message, ts: Date.now() };
    isPaused = true;
    logger.error?.(`[RECOVERY] failed closed: ${err.message}`);
  }
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info?.(`[SHUTDOWN] ${signal} received, shutting down gracefully...`);
  cronJobs.forEach(j => j.stop());
  intervalTimers.forEach(t => clearInterval(t));
  if (dbBulkTimer) clearInterval(dbBulkTimer);
  if (lockHeartbeatInterval) clearInterval(lockHeartbeatInterval);
  if (dbReconnectInterval) { clearInterval(dbReconnectInterval); dbReconnectInterval = null; }
  server.close();

  // Orchestration platforms (Render, k8s, ...) send SIGTERM but only grant a
  // finite grace period before SIGKILL. If SIGKILL lands before this handler
  // finishes, releaseInstanceLock() never runs and the mongo lock document is
  // orphaned with a frozen lastSeen — the next deploy then has to wait out the
  // full LOCK_STALE_AFTER_MS window before it can take over. To guarantee the
  // lock is freed within that grace period:
  //   1. Release the lock FIRST, before any other (potentially slow/hanging)
  //      cleanup work such as flushing the DB bulk queue.
  //   2. Wrap the whole shutdown in a hard deadline so a stuck network call
  //      (e.g. a degraded MongoDB connection) can never block process exit.
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => { logger.warn?.(`[SHUTDOWN] ${label} timed out after ${ms}ms, continuing`); resolve(undefined); }, ms))
  ]);

  const hardExitTimer = setTimeout(() => {
    logger.error?.('[SHUTDOWN] Hard deadline exceeded, forcing exit.');
    process.exit(0);
  }, 8000);
  hardExitTimer.unref?.();

  await withTimeout(releaseInstanceLock(), 2000, 'releaseInstanceLock');
  await withTimeout(processDbBulkQueue(), 3000, 'processDbBulkQueue');
  await withTimeout(client.close().catch(() => {}), 2000, 'client.close');

  clearTimeout(hardExitTimer);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', async (err) => {
  logger.error(`💥 Uncaught Exception: ${err.message}\n${err.stack}`);
  await gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', async (reason) => {
  logger.error(`💥 Unhandled Rejection: ${reason}`);
  await gracefulShutdown('unhandledRejection');
});

// ==========================================
// 20. BOT START (ASYNCHRON & ABSICHERT & DAUERHAFT)
// ==========================================
(async () => {
  logger.info('🚀 Starte Trading Bot v25.0.9 Institutional Edition (Full Features, TensorFlow.js ML, DQN Agent, Cross-Hedging, Volatility Surface & Order Flow)...');
  
  await initDatabase();
  await loadFuturesContractSpecs();
  await loadSignalMLModel();
  if (!isModelTrained) await runMLTrainingSafely(true, 'startup');
  await registerTelegramCommands();
  pollTelegramUpdates();

  const runScanCycle = async () => {
    try {
      if (isDbConnected) {
        await scanMarket();
      } else {
        logger.warn('⚠️ Scan übersprungen, warte auf DB-Reconnect...');
      }
    } catch (error) {
      logger.error(`Fehler im Scan-Zyklus: ${error.message}`);
    }
  };

  await runScanCycle();

  const SCAN_INTERVAL_MS = 5 * 60 * 1000; 
  const scanTimer = setInterval(runScanCycle, SCAN_INTERVAL_MS);
intervalTimers.push(scanTimer);
  
  logger.info(`🔄 Bot-Dauerschleife aktiv. Nächster Scan in ${SCAN_INTERVAL_MS / 60000} Minuten.`);
})();
