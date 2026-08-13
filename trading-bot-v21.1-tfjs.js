/**
 * ============================================================================
 * TRADING SIGNAL BOT - ULTIMATE v21.5 DYNAMIC FILTER ENGINE EDITION
 * (Mit adaptivem TensorFlow.js ML, globaler Telegram-Queue, State-Persistenz,
 *  Hurst-Exponent, Marktphasen-Logging, Dynamic Filter Control & Web-Backtest)
 * ============================================================================
 */[cite: 5]

require('dotenv').config();[cite: 5]
const express = require('express');[cite: 5]
const cron = require('node-cron');[cite: 5]
const axios = require('axios');[cite: 5]
const { MongoClient } = require('mongodb');[cite: 5]
const winston = require('winston');[cite: 5]
const { TensorFlowSignalModel } = require('./ml-engine');[cite: 5]
const { runBacktest, buildConfig: buildBacktestConfig } = require('./backtest-engine');[cite: 5]

// ==========================================
// 1. LOGGER, LOG-SPEICHER & GLOBALE ZUSTÄNDE
// ==========================================
const { Writable } = require('stream');[cite: 5]

const recentLogs = [];[cite: 5]
const memoryStream = new Writable({[cite: 5]
  write(chunk, encoding, callback) {[cite: 5]
    recentLogs.push(chunk.toString().trim());[cite: 5]
    if (recentLogs.length > 50) recentLogs.shift();[cite: 5]
    callback();[cite: 5]
  }[cite: 5]
});[cite: 5]

const memoryLogTransport = new winston.transports.Stream({[cite: 5]
  stream: memoryStream[cite: 5]
});[cite: 5]

const logger = winston.createLogger({[cite: 5]
  level: 'info',[cite: 5]
  format: winston.format.combine([cite: 5]
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),[cite: 5]
    winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)[cite: 5]
  ),[cite: 5]
  transports: [[cite: 5]
    new winston.transports.Console(),[cite: 5]
    memoryLogTransport[cite: 5]
  ][cite: 5]
});[cite: 5]

let isShuttingDown = false;[cite: 5]
let currentMarketPhase = 'RANGING';[cite: 5]
let adaptiveConfig = null;[cite: 5]
let lastScanStats = null;[cite: 5]
let scanCounter = 0;[cite: 5]

let currentStreak = 0;[cite: 5]
let maxWinStreak = 0;[cite: 5]
let maxLossStreak = 0;[cite: 5]

let peakCapital = parseFloat(process.env.CAPITAL_USD) || 10000;[cite: 5]
let dailyNetPnL = 0;[cite: 5]
let consecutiveLosses = 0;[cite: 5]

const MAX_DRAWDOWN_PERCENT = parseFloat(process.env.MAX_DRAWDOWN_PERCENT) || 25;[cite: 5]
const DAILY_PROFIT_TARGET = parseFloat(process.env.DAILY_PROFIT_TARGET) || 500;[cite: 5]

let kucoinErrorCount = 0;[cite: 5]
let kucoinCircuitOpenUntil = 0;[cite: 5]
const KUCOIN_CIRCUIT_THRESHOLD = 3;[cite: 5]
const KUCOIN_CIRCUIT_COOLDOWN_MS = 300000;[cite: 5]

const manualBlacklist = new Set();[cite: 5]

// ==========================================
// 2. FILTER REGISTRY & ZENTRALE KONFIGURATION
// ==========================================
const FILTER_REGISTRY = {[cite: 5]
  hurst: { configKey: 'MIN_HURST_EXPONENT', name: 'Hurst Exponent', default: 0.52, type: 'numeric', step: 0.02, direction: 'higher_is_harder', min: 0.0, max: 0.95 },[cite: 5]
  adx:   { configKey: 'ADX_MIN',            name: 'ADX Minimum',    default: 20,   type: 'numeric', step: 2.0,  direction: 'higher_is_harder', min: 0,   max: 60 },[cite: 5]
  bos:   { configKey: 'BOS_LOOKBACK',       name: 'BOS Lookback',   default: 10,   type: 'numeric', step: 2,    direction: 'higher_is_harder', min: 2,   max: 50 },[cite: 5]
  relvol:{ configKey: 'MIN_RELATIVE_VOLUME',name: 'Rel. Volumen',   default: 1.2,  type: 'numeric', step: 0.1,  direction: 'higher_is_harder', min: 0.0, max: 10.0 },[cite: 5]
  chop:  { configKey: 'MAX_CHOP_INDEX',     name: 'Max Chop Index', default: 61.8, type: 'numeric', step: 2.0,  direction: 'lower_is_harder',  min: 10,  max: 90 },[cite: 5]
  rsi_long_min:  { configKey: 'RSI_LONG_MIN',  name: 'RSI Long Min',   default: 48,   type: 'numeric', step: 2.0,  direction: 'higher_is_harder', min: 10,  max: 80 },[cite: 5]
  rsi_short_max: { configKey: 'RSI_SHORT_MAX', name: 'RSI Short Max',  default: 52,   type: 'numeric', step: 2.0,  direction: 'lower_is_harder',  min: 20,  max: 90 },[cite: 5]
  trend4h:       { configKey: 'REQUIRE_4H_TREND', name: '4H Trend-Filter', default: true, type: 'boolean' },[cite: 5]
  btctrend:      { configKey: 'ALLOW_COUNTER_BTC_TREND', name: 'Gegen-BTC-Trend', default: false, type: 'boolean' }[cite: 5]
};[cite: 5]

const filterState = {};[cite: 5]
Object.keys(FILTER_REGISTRY).forEach(key => {[cite: 5]
  filterState[key] = { enabled: true };[cite: 5]
});[cite: 5]

// ==========================================
// 3. API LATENZ & RATE LIMITER
// ==========================================
const apiLatencyStats = {[cite: 5]
  kucoin: [],[cite: 5]
  telegram: [],[cite: 5]
  mongodb: [],[cite: 5]
  
  record(service, latencyMs) {[cite: 5]
    if (!this[service]) this[service] = [];[cite: 5]
    this[service].push({ time: Date.now(), latency: latencyMs });[cite: 5]
    if (this[service].length > 100) this[service].shift();[cite: 5]
  },[cite: 5]
  
  getAverage(service) {[cite: 5]
    if (!this[service] || this[service].length === 0) return 0;[cite: 5]
    return this[service].reduce((sum, e) => sum + e.latency, 0) / this[service].length;[cite: 5]
  }[cite: 5]
};[cite: 5]

const apiRateLimiter = {[cite: 5]
  requests: 0,[cite: 5]
  windowStart: Date.now(),[cite: 5]
  maxRequests: 1800,[cite: 5]
  windowMs: 60000,[cite: 5]
  
  async checkLimit() {[cite: 5]
    const now = Date.now();[cite: 5]
    if (now - this.windowStart > this.windowMs) {[cite: 5]
      this.requests = 0;[cite: 5]
      this.windowStart = now;[cite: 5]
    }[cite: 5]
    if (this.requests >= this.maxRequests) {[cite: 5]
      const waitMs = this.windowMs - (now - this.windowStart) + 100;[cite: 5]
      logger.warn(`⚠️ API Rate-Limit erreicht (${this.requests}/${this.maxRequests}), warte ${waitMs}ms`);[cite: 5]
      await sleep(waitMs);[cite: 5]
      this.requests = 0;[cite: 5]
      this.windowStart = Date.now();[cite: 5]
    }[cite: 5]
    this.requests++;[cite: 5]
  }[cite: 5]
};[cite: 5]

// ==========================================
// 4. BULK QUEUE & LRU CACHE
// ==========================================
let dbBulkQueue = [];[cite: 5]
let dbBulkTimer = null;[cite: 5]

class LRUCache {[cite: 5]
  constructor(maxSize) {[cite: 5]
    this.maxSize = maxSize;[cite: 5]
    this.cache = new Map();[cite: 5]
  }[cite: 5]
  
  get(key) {[cite: 5]
    if (!this.cache.has(key)) return null;[cite: 5]
    const value = this.cache.get(key);[cite: 5]
    this.cache.delete(key);[cite: 5]
    this.cache.set(key, value);[cite: 5]
    return value;[cite: 5]
  }[cite: 5]
  
  set(key, value) {[cite: 5]
    if (this.cache.has(key)) {[cite: 5]
      this.cache.delete(key);[cite: 5]
    } else if (this.cache.size >= this.maxSize) {[cite: 5]
      const firstKey = this.cache.keys().next().value;[cite: 5]
      this.cache.delete(firstKey);[cite: 5]
    }[cite: 5]
    this.cache.set(key, value);[cite: 5]
  }[cite: 5]
  
  delete(key) { this.cache.delete(key); }[cite: 5]
  has(key) { return this.cache.has(key); }[cite: 5]
  get size() { return this.cache.size; }[cite: 5]
  
  cleanup(maxAge) {[cite: 5]
    const now = Date.now();[cite: 5]
    for (const [key, value] of this.cache.entries()) {[cite: 5]
      if (now - value.timestamp > maxAge) this.cache.delete(key);[cite: 5]
    }[cite: 5]
  }[cite: 5]
}[cite: 5]

// ==========================================
// 5. HELFER & TELEGRAM ENGINE
// ==========================================
function safeParseFloat(value, fieldName, context) {[cite: 5]
  const parsed = parseFloat(value);[cite: 5]
  if (!Number.isFinite(parsed)) {[cite: 5]
    logger.error(`[DATA ERROR] ${fieldName} bei ${context}: ${JSON.stringify(value)}`);[cite: 5]
    return null;[cite: 5]
  }[cite: 5]
  return parsed;[cite: 5]
}[cite: 5]

function escapeHtml(value) {[cite: 5]
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');[cite: 5]
}[cite: 5]

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }[cite: 5]
function todayUTCString() { return new Date().toISOString().slice(0, 10); }[cite: 5]

const configTelegram = {[cite: 5]
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',[cite: 5]
  chatId: process.env.TELEGRAM_CHAT_ID || ''[cite: 5]
};[cite: 5]

let telegramQueue = Promise.resolve();[cite: 5]

function queueTelegramMessage(taskFn) {[cite: 5]
  telegramQueue = telegramQueue.then(async () => {[cite: 5]
    try {[cite: 5]
      await taskFn();[cite: 5]
    } catch (e) {}[cite: 5]
  });[cite: 5]
  return telegramQueue;[cite: 5]
}[cite: 5]

async function sendTelegramAlert(text) {[cite: 5]
  if (!configTelegram.botToken || !configTelegram.chatId) return;[cite: 5]
  const startTime = Date.now();[cite: 5]
  const chatIds = configTelegram.chatId.split(',').map(id => id.trim()).filter(Boolean);[cite: 5]

  for (const chatId of chatIds) {[cite: 5]
    await queueTelegramMessage(async () => {[cite: 5]
      let success = false;[cite: 5]
      let attempts = 0;[cite: 5]
      let delay = 3000;[cite: 5]

      while (!success && attempts < 3) {[cite: 5]
        try {[cite: 5]
          attempts++;[cite: 5]
          await axios.post([cite: 5]
            `https://api.telegram.org/bot${configTelegram.botToken}/sendMessage`,[cite: 5]
            { chat_id: chatId, text: text, parse_mode: 'HTML' },[cite: 5]
            { timeout: 10000 }[cite: 5]
          );[cite: 5]
          success = true;[cite: 5]
          await sleep(500);[cite: 5]
        } catch (e) {[cite: 5]
          if (e.response && e.response.status === 429) {[cite: 5]
            logger.warn(`⚠️ Telegram Rate-Limit (429) für Chat ${chatId}. Warte ${delay}ms...`);[cite: 5]
            await sleep(delay);[cite: 5]
            delay *= 2;[cite: 5]
          } else {[cite: 5]
            logger.error(`Telegram (${chatId}): ${e.message}`);[cite: 5]
            break;[cite: 5]
          }[cite: 5]
        }[cite: 5]
      }[cite: 5]
    });[cite: 5]
  }[cite: 5]
  apiLatencyStats.record('telegram', Date.now() - startTime);[cite: 5]
}[cite: 5]

async function sendTelegramReply(chatId, text) {[cite: 5]
  if (!configTelegram.botToken || !chatId) return;[cite: 5]
  await queueTelegramMessage(async () => {[cite: 5]
    let success = false;[cite: 5]
    let attempts = 0;[cite: 5]
    let delay = 3000;[cite: 5]

    while (!success && attempts < 3) {[cite: 5]
      try {[cite: 5]
        attempts++;[cite: 5]
        await axios.post([cite: 5]
          `https://api.telegram.org/bot${configTelegram.botToken}/sendMessage`,[cite: 5]
          { chat_id: chatId, text: text, parse_mode: 'HTML' },[cite: 5]
          { timeout: 10000 }[cite: 5]
        );[cite: 5]
        success = true;[cite: 5]
        await sleep(500);[cite: 5]
      } catch (e) {[cite: 5]
        if (e.response && e.response.status === 429) {[cite: 5]
          logger.warn(`⚠️ Telegram Reply Rate-Limit (429) für Chat ${chatId}. Warte ${delay}ms...`);[cite: 5]
          await sleep(delay);[cite: 5]
          delay *= 2;[cite: 5]
        } else {[cite: 5]
          logger.error(`Telegram Reply (${chatId}): ${e.message}`);[cite: 5]
          break;[cite: 5]
        }[cite: 5]
      }[cite: 5]
    }[cite: 5]
  });[cite: 5]
}[cite: 5]

async function getAlertTimestamp(key) {[cite: 5]
  if (!botStateCollection || !isDbConnected) return 0;[cite: 5]
  try {[cite: 5]
    const doc = await botStateCollection.findOne({ _id: `alert_${key}` });[cite: 5]
    return doc ? doc.lastSent : 0;[cite: 5]
  } catch (e) {[cite: 5]
    return 0;[cite: 5]
  }[cite: 5]
}[cite: 5]

async function persistAlertHistoryEntry(key, timestamp) {[cite: 5]
  if (!botStateCollection || !isDbConnected) return;[cite: 5]
  try {[cite: 5]
    await botStateCollection.updateOne([cite: 5]
      { _id: `alert_${key}` },[cite: 5]
      { $set: { lastSent: timestamp } },[cite: 5]
      { upsert: true }[cite: 5]
    );[cite: 5]
  } catch (e) {}[cite: 5]
}[cite: 5]

async function sendDeduplicatedAlert(key, text, cooldownMs = 300000) {[cite: 5]
  const lastSent = await getAlertTimestamp(key);[cite: 5]
  if (Date.now() - lastSent < cooldownMs) return;[cite: 5]
  await persistAlertHistoryEntry(key, Date.now());[cite: 5]
  await sendTelegramAlert(text);[cite: 5]
}[cite: 5]

async function sendBatchedSignalAlert(signals) {[cite: 5]
  if (signals.length === 0) return;[cite: 5]
  if (signals.length === 1) {[cite: 5]
    await sendTelegramAlert(signals[0].text);[cite: 5]
    return;[cite: 5]
  }[cite: 5]
  let batchText = `🚀 <b>${signals.length} NEUE SIGNALE</b>\n━━━━━━━━━━━━━━━━━━\n\n`;[cite: 5]
  signals.forEach((signal, index) => {[cite: 5]
    batchText += `${index + 1}. ${signal.text}\n\n`;[cite: 5]
  });[cite: 5]
  batchText += `⚠️ <b>Mehrere Signale - Position Sizing beachten!</b>`;[cite: 5]
  await sendTelegramAlert(batchText);[cite: 5]
}[cite: 5]

function updateTelegramConfig(token, chatId) {[cite: 5]
  configTelegram.botToken = token;[cite: 5]
  configTelegram.chatId = chatId;[cite: 5]
}[cite: 5]

// ==========================================
// 5.1 NEU: AUTOMATISCHER GEMINI-RISIKO-CHECK
// ==========================================
async function evaluateSignalWithGemini(symbol, direction, score, marketPhase, mlProbability) {
  if (!process.env.GEMINI_API_KEY) return { approved: true, reason: 'no-api-key' };
  
  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `Du bist ein strenger Chef-Risikomanager im Krypto-Trading. 
    Analysiere folgendes Setup und entscheide, ob es freigegeben wird:
    - Coin: ${symbol}
    - Richtung: ${direction}
    - Technischer Score: ${score}/100
    - Marktphase: ${marketPhase}
    - ML-Modell Erfolgswahrscheinlichkeit: ${(mlProbability * 100).toFixed(1)}%
    
    Antworte EXAKT im folgenden JSON-Format ohne Markdown-Code-Blocks drumherum:
    {"approved": true/false, "reason": "Kurze Begründung auf Deutsch"}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
    });

    const text = response.text.trim();
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch (e) {
    logger.warn(`[Gemini Risk Check] Fehler bei API-Abfrage: ${e.message}. Signal wird im Zweifel zugelassen.`);
    return { approved: true, reason: 'api-error-fallback' };
  }
}

// ==========================================
// 6. KORRELATIONS-GRUPPEN
// ==========================================
const CORRELATION_GROUPS = {[cite: 5]
  'MAJOR':   ['BTC-USDT', 'ETH-USDT'],[cite: 5]
  'DEFI':    ['UNI-USDT', 'AAVE-USDT', 'MKR-USDT', 'COMP-USDT', 'CRV-USDT', 'SNX-USDT'],[cite: 5]
  'L1':      ['SOL-USDT', 'AVAX-USDT', 'NEAR-USDT', 'APT-USDT', 'SUI-USDT', 'SEI-USDT'],[cite: 5]
  'L2':      ['ARB-USDT', 'OP-USDT', 'MATIC-USDT', 'IMX-USDT', 'STRK-USDT'],[cite: 5]
  'MEME':    ['DOGE-USDT', 'SHIB-USDT', 'PEPE-USDT', 'WIF-USDT', 'BONK-USDT'],[cite: 5]
  'AI':      ['FET-USDT', 'AGIX-USDT', 'OCEAN-USDT', 'WLD-USDT', 'RNDR-USDT'],[cite: 5]
  'GAMING':  ['GALA-USDT', 'SAND-USDT', 'MANA-USDT', 'AXS-USDT'],[cite: 5]
};[cite: 5]

function checkCorrelationLimit(symbol, direction, activeTrades, enabled = true) {[cite: 5]
  if (!enabled) return true;[cite: 5]
  for (const [group, coins] of Object.entries(CORRELATION_GROUPS)) {[cite: 5]
    if (coins.includes(symbol)) {[cite: 5]
      const sameInGroup = [...activeTrades.values()].filter(t => coins.includes(t.symbol) && t.direction === direction).length;[cite: 5]
      return sameInGroup === 0;[cite: 5]
    }[cite: 5]
  }[cite: 5]
  return true;[cite: 5]
}[cite: 5]

// ==========================================
// 7. STRATEGIE PROFILES & CONFIG
// ==========================================
const STRATEGY_PROFILES = {[cite: 5]
  loose: {[cite: 5]
    ALLOW_COUNTER_BTC_TREND: true,[cite: 5]
    REQUIRE_4H_TREND: false,[cite: 5]
    ADX_MIN: 15,[cite: 5]
    RSI_LONG_MIN: 40,[cite: 5]
    RSI_LONG_MAX: 75,[cite: 5]
    RSI_SHORT_MIN: 25,[cite: 5]
    RSI_SHORT_MAX: 60,[cite: 5]
    MIN_RELATIVE_VOLUME: 0.8,[cite: 5]
    BOS_LOOKBACK: 4,[cite: 5]
    TREND_EMA_FAST_15M: 20,       [cite: 5]
    TREND_EMA_SLOW_15M: 50,[cite: 5]
  },[cite: 5]
  strict: {[cite: 5]
    ALLOW_COUNTER_BTC_TREND: false,[cite: 5]
    REQUIRE_4H_TREND: true,[cite: 5]
    ADX_MIN: 20,[cite: 5]
    RSI_LONG_MIN: 48,[cite: 5]
    RSI_LONG_MAX: 68,[cite: 5]
    RSI_SHORT_MIN: 32,[cite: 5]
    RSI_SHORT_MAX: 52,[cite: 5]
    MIN_RELATIVE_VOLUME: 1.2,[cite: 5]
    BOS_LOOKBACK: 10,[cite: 5]
    TREND_EMA_FAST_15M: 20,[cite: 5]
    TREND_EMA_SLOW_15M: 50,[cite: 5]
  }[cite: 5]
};[cite: 5]

let STRATEGY_PROFILE_NAME = (process.env.STRATEGY_PROFILE || 'strict').toLowerCase();[cite: 5]
let activeProfile = STRATEGY_PROFILES[STRATEGY_PROFILE_NAME] || STRATEGY_PROFILES.strict;[cite: 5]

function envFloatOrProfile(envVal, profileVal) { return envVal !== undefined ? parseFloat(envVal) : profileVal; }[cite: 5]
function envBoolOrProfile(envVal, profileVal, trueLiteral) {[cite: 5]
  if (envVal === undefined) return profileVal;[cite: 5]
  return trueLiteral ? envVal === 'true' : envVal !== 'false';[cite: 5]
}[cite: 5]

const config = {[cite: 5]
  PORT: parseInt(process.env.PORT, 10) || 10000,[cite: 5]
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',[cite: 5]
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',[cite: 5]
  MONGODB_URI: process.env.MONGODB_URI || '',[cite: 5]
  
  CAPITAL_USD: parseFloat(process.env.CAPITAL_USD) || 10000,[cite: 5]
  RISK_PERCENT: parseFloat(process.env.RISK_PERCENT) || 0.75,[cite: 5]
  TOP_COIN_LIMIT: parseInt(process.env.TOP_COIN_LIMIT, 10) || 150,[cite: 5]
  MAX_SIGNALS_PER_SCAN: parseInt(process.env.MAX_SIGNALS_PER_SCAN, 10) || 5,[cite: 5]
  MAX_CONCURRENT_TRADES: parseInt(process.env.MAX_CONCURRENT_TRADES, 10) || 3,[cite: 5]
  MAX_DAILY_LOSS_USD: parseFloat(process.env.MAX_DAILY_LOSS_USD) || 250,[cite: 5]
  MAX_FUNDING_RATE: parseFloat(process.env.MAX_FUNDING_RATE) || 0.0005,[cite: 5]
  MIN_FUNDING_RATE: parseFloat(process.env.MIN_FUNDING_RATE) || -0.0005,[cite: 5]

  ALLOW_COUNTER_BTC_TREND: envBoolOrProfile(process.env.ALLOW_COUNTER_BTC_TREND, activeProfile.ALLOW_COUNTER_BTC_TREND, false),[cite: 5]
  REQUIRE_4H_TREND: envBoolOrProfile(process.env.REQUIRE_4H_TREND, activeProfile.REQUIRE_4H_TREND, true),[cite: 5]
  ADX_MIN: envFloatOrProfile(process.env.ADX_MIN, activeProfile.ADX_MIN),[cite: 5]
  RSI_LONG_MIN: envFloatOrProfile(process.env.RSI_LONG_MIN, activeProfile.RSI_LONG_MIN),[cite: 5]
  RSI_LONG_MAX: envFloatOrProfile(process.env.RSI_LONG_MAX, activeProfile.RSI_LONG_MAX),[cite: 5]
  RSI_SHORT_MIN: envFloatOrProfile(process.env.RSI_SHORT_MIN, activeProfile.RSI_SHORT_MIN),[cite: 5]
  RSI_SHORT_MAX: envFloatOrProfile(process.env.RSI_SHORT_MAX, activeProfile.RSI_SHORT_MAX),[cite: 5]
  MIN_RELATIVE_VOLUME: envFloatOrProfile(process.env.MIN_RELATIVE_VOLUME, activeProfile.MIN_RELATIVE_VOLUME),[cite: 5]
  BOS_LOOKBACK: process.env.BOS_LOOKBACK !== undefined ? parseInt(process.env.BOS_LOOKBACK, 10) : activeProfile.BOS_LOOKBACK,[cite: 5]
  TREND_EMA_FAST_15M: process.env.TREND_EMA_FAST_15M !== undefined ? parseInt(process.env.TREND_EMA_FAST_15M, 10) : activeProfile.TREND_EMA_FAST_15M,[cite: 5]
  TREND_EMA_SLOW_15M: process.env.TREND_EMA_SLOW_15M !== undefined ? parseInt(process.env.TREND_EMA_SLOW_15M, 10) : activeProfile.TREND_EMA_SLOW_15M,[cite: 5]

  ATR_STOP_MULT: parseFloat(process.env.ATR_STOP_MULT) || 2.3,[cite: 5]
  TP1_MULT: parseFloat(process.env.TP1_MULT) || 1.3,[cite: 5]
  TP2_MULT: parseFloat(process.env.TP2_MULT) || 2.5,[cite: 5]
  MAX_HOLD_HOURS: parseFloat(process.env.MAX_HOLD_HOURS) || 4,[cite: 5]
  ABSOLUTE_MAX_HOLD_HOURS: parseFloat(process.env.ABSOLUTE_MAX_HOLD_HOURS) || 24,[cite: 5]
  MAX_SAME_DIRECTION: parseInt(process.env.MAX_SAME_DIRECTION, 10) || 2,[cite: 5]
  TRAILING_STOP_ENABLED: process.env.TRAILING_STOP_ENABLED !== 'false',[cite: 5]
  TRAILING_ATR_MULT: parseFloat(process.env.TRAILING_ATR_MULT) || 2.2,[cite: 5]
  DYNAMIC_TRAILING_ATR: process.env.DYNAMIC_TRAILING_ATR !== 'false',[cite: 5]
  FAST_TRACK_INTERVAL_SECONDS: parseInt(process.env.FAST_TRACK_INTERVAL_SECONDS, 10) || 60,[cite: 5]
  TICKER_BATCH_SIZE: parseInt(process.env.TICKER_BATCH_SIZE, 10) || 10,[cite: 5]
  SLIPPAGE_PERCENT: parseFloat(process.env.SLIPPAGE_PERCENT) || 0.05,[cite: 5]
  FEE_PERCENT: parseFloat(process.env.FEE_PERCENT) || 0.1,[cite: 5]
  TP1_CLOSE_PERCENT: parseFloat(process.env.TP1_CLOSE_PERCENT) || 60,[cite: 5]
  ENABLE_SHORT_SIGNALS: process.env.ENABLE_SHORT_SIGNALS !== 'false',[cite: 5]
  MAX_EXPOSURE_RATIO: parseFloat(process.env.MAX_EXPOSURE_RATIO) || 0.6,[cite: 5]
  SCAN_CONCURRENCY: parseInt(process.env.SCAN_CONCURRENCY, 10) || 5,[cite: 5]
  MAX_CONSECUTIVE_PRICE_FAILURES: parseInt(process.env.MAX_CONSECUTIVE_PRICE_FAILURES, 10) || 10,[cite: 5]
  LEVERAGE: parseInt(process.env.LEVERAGE, 10) || 3,[cite: 5]
  MARGIN_MODE: (process.env.MARGIN_MODE || 'ISOLATED').toUpperCase(),[cite: 5]

  LOCK_ACQUIRE_RETRIES: parseInt(process.env.LOCK_ACQUIRE_RETRIES, 10) || 8,[cite: 5]
  LOCK_ACQUIRE_RETRY_DELAY_MS: parseInt(process.env.LOCK_ACQUIRE_RETRY_DELAY_MS, 10) || 5000,[cite: 5]
  LOCK_STALE_AFTER_MS: parseInt(process.env.LOCK_STALE_AFTER_MS, 10) || 5 * 60 * 1000,[cite: 5]

  FUNDING_INTERVAL_HOURS: parseFloat(process.env.FUNDING_INTERVAL_HOURS) || 8,[cite: 5]
  SCAN_STATS_TELEGRAM_EVERY_N_SCANS: parseInt(process.env.SCAN_STATS_TELEGRAM_EVERY_N_SCANS, 10) || 4,[cite: 5]
  
  MAX_KLINES_CACHE_SIZE: parseInt(process.env.MAX_KLINES_CACHE_SIZE, 10) || 200,[cite: 5]
  CACHE_CLEANUP_MINUTES: parseInt(process.env.CACHE_CLEANUP_MINUTES, 10) || 5,[cite: 5]
  
  RISK_WARNING_ENABLED: process.env.RISK_WARNING_ENABLED !== 'false',[cite: 5]
  MAX_WEEKLY_DRAWDOWN_PERCENT: parseFloat(process.env.MAX_WEEKLY_DRAWDOWN_PERCENT) || 10,[cite: 5]
  MAX_CONSECUTIVE_LOSSES: parseInt(process.env.MAX_CONSECUTIVE_LOSSES, 10) || 3,[cite: 5]
  
  ENABLE_ADAPTIVE_PARAMS: process.env.ENABLE_ADAPTIVE_PARAMS !== 'false',[cite: 5]
  ENABLE_KELLY_SIZING: process.env.ENABLE_KELLY_SIZING !== 'false',[cite: 5]
  ENABLE_ORDERBOOK_ANALYSIS: process.env.ENABLE_ORDERBOOK_ANALYSIS !== 'false',[cite: 5]
  ENABLE_CORRELATION_LIMITS: process.env.ENABLE_CORRELATION_LIMITS !== 'false',[cite: 5]
  ENABLE_MULTI_TF_DERIVATION: process.env.ENABLE_MULTI_TF_DERIVATION !== 'false',[cite: 5]
  ENABLE_PRELOADING: process.env.ENABLE_PRELOADING !== 'false',[cite: 5]
  ENABLE_BATCH_SIGNALS: process.env.ENABLE_BATCH_SIGNALS !== 'false',[cite: 5]
  ORDERBOOK_DEPTH_LEVELS: parseInt(process.env.ORDERBOOK_DEPTH_LEVELS, 10) || 10,[cite: 5]
  
  MAX_DRAWDOWN_PERCENT: parseFloat(process.env.MAX_DRAWDOWN_PERCENT) || 25,[cite: 5]
  DAILY_PROFIT_TARGET: parseFloat(process.env.DAILY_PROFIT_TARGET) || 500,[cite: 5]
  MONGODB_POOL_SIZE: parseInt(process.env.MONGODB_POOL_SIZE, 10) || 10,[cite: 5]
  DB_BULK_INTERVAL_MS: parseInt(process.env.DB_BULK_INTERVAL_MS, 10) || 5000,[cite: 5]
  
  MAX_SPREAD_PERCENT: parseFloat(process.env.MAX_SPREAD_PERCENT) || 0.15,[cite: 5]
  MAX_CHOP_INDEX: parseFloat(process.env.MAX_CHOP_INDEX) || 61.8,[cite: 5]
  MIN_HURST_EXPONENT: parseFloat(process.env.MIN_HURST_EXPONENT) || 0.52,[cite: 5]

  ML_ENABLED: process.env.ML_ENABLED !== 'false',[cite: 5]
  ML_MIN_TRAINING_SAMPLES: parseInt(process.env.ML_MIN_TRAINING_SAMPLES, 10) || 40,[cite: 5]
  ML_MAX_TRAINING_SAMPLES: parseInt(process.env.ML_MAX_TRAINING_SAMPLES, 10) || 2000,[cite: 5]
  ML_MIN_PREDICTION_PROBABILITY: parseFloat(process.env.ML_MIN_PREDICTION_PROBABILITY) || 0.55,[cite: 5]
  ML_STRONG_SIGNAL_PROBABILITY: parseFloat(process.env.ML_STRONG_SIGNAL_PROBABILITY) || 0.70,[cite: 5]
  ML_RETRAIN_HOURS: parseFloat(process.env.ML_RETRAIN_HOURS) || 6,[cite: 5]
  ML_EPOCHS: parseInt(process.env.ML_EPOCHS, 10) || 80,[cite: 5]
  ML_BATCH_SIZE: parseInt(process.env.ML_BATCH_SIZE, 10) || 32,[cite: 5]
};[cite: 5]

function validateConfig() {
  const numericFields = [
    'PORT', 'CAPITAL_USD', 'RISK_PERCENT', 'TOP_COIN_LIMIT', 'MAX_SIGNALS_PER_SCAN',
    'MAX_CONCURRENT_TRADES', 'MAX_DAILY_LOSS_USD', 'MAX_FUNDING_RATE', 'MIN_FUNDING_RATE',
    'ADX_MIN', 'BOS_LOOKBACK', 'RSI_LONG_MIN', 'RSI_LONG_MAX', 'RSI_SHORT_MIN',
    'RSI_SHORT_MAX', 'ATR_STOP_MULT', 'TP1_MULT', 'TP2_MULT', 'MAX_HOLD_HOURS',
    'ABSOLUTE_MAX_HOLD_HOURS', 'MIN_RELATIVE_VOLUME', 'MAX_SAME_DIRECTION',
    'TRAILING_ATR_MULT', 'FAST_TRACK_INTERVAL_SECONDS', 'TICKER_BATCH_SIZE',
    'SLIPPAGE_PERCENT', 'FEE_PERCENT', 'TP1_CLOSE_PERCENT', 'MAX_EXPOSURE_RATIO',
    'SCAN_CONCURRENCY', 'MAX_CONSECUTIVE_PRICE_FAILURES', 'LEVERAGE',
    'LOCK_ACQUIRE_RETRIES', 'LOCK_ACQUIRE_RETRY_DELAY_MS', 'LOCK_STALE_AFTER_MS',
    'FUNDING_INTERVAL_HOURS', 'SCAN_STATS_TELEGRAM_EVERY_N_SCANS',
    'TREND_EMA_FAST_15M', 'TREND_EMA_SLOW_15M',
    'MAX_KLINES_CACHE_SIZE', 'CACHE_CLEANUP_MINUTES',
    'MAX_WEEKLY_DRAWDOWN_PERCENT', 'MAX_CONSECUTIVE_LOSSES',
    'ORDERBOOK_DEPTH_LEVELS', 'MAX_DRAWDOWN_PERCENT', 'DAILY_PROFIT_TARGET',
    'MONGODB_POOL_SIZE', 'DB_BULK_INTERVAL_MS', 'MAX_SPREAD_PERCENT', 'MAX_CHOP_INDEX',
    'MIN_HURST_EXPONENT', 'ML_MIN_TRAINING_SAMPLES', 'ML_MAX_TRAINING_SAMPLES',
    'ML_MIN_PREDICTION_PROBABILITY', 'ML_STRONG_SIGNAL_PROBABILITY', 'ML_RETRAIN_HOURS',
    'ML_EPOCHS', 'ML_BATCH_SIZE'
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
  if (missing.length > 0) throw new Error(`[STARTUP ERROR] Fehlende Variablen: ${missing.join(', ')}`);
}
validateCriticalEnv();

updateTelegramConfig(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);

// ==========================================
// 8. DATENBANK & ADAPTIVES ML-MODELL
// ==========================================
const client = new MongoClient(config.MONGODB_URI, {
  maxPoolSize: config.MONGODB_POOL_SIZE,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
  family: 4
});

let tradesCollection, closedTradesCollection, botStateCollection, lockCollection, marketPhaseLogsCollection, filterChangeLogCollection;
const activeTrades = new Map();
let isDbConnected = false, dbReconnectInterval = null, pendingClosedTrades = [];
const priceFailureCounts = new Map();
let isPaused = false, lastScanTime = null, lastTrackerCheckTime = null;
let trackerLock = false, trackerTimeout = null;
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
let isModelTrained = false;
let lastMLTrainingStats = null;

function buildMLFeatures(data) {
  return mlModel.buildFeatures(data);
}

async function trainSignalMLModel(force = false) {
  if (!config.ML_ENABLED) return { trained: false, reason: 'disabled' };
  if (!closedTradesCollection || !isDbConnected) return { trained: false, reason: 'db-unavailable' };
  try {
    const result = await mlModel.trainFromTrades(closedTradesCollection, { force });
    isModelTrained = !!result.trained;
    lastMLTrainingStats = result;
    return result;
  } catch (e) {
    logger.error(`[TensorFlow.js ML Fehler beim Training]: ${e.message}`);
    return { trained: false, reason: e.message };
  }
}

async function loadSignalMLModel() {
  if (!config.ML_ENABLED) return false;
  try {
    const loaded = await mlModel.load();
    isModelTrained = loaded;
    if (loaded) lastMLTrainingStats = mlModel.getStats();
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
    dbBulkQueue.push(...batch);
  }
}

async function loadPauseState() {
  if (!botStateCollection) return;
  try {
    const doc = await botStateCollection.findOne({ _id: 'botControl' });
    if (doc) isPaused = !!doc.isPaused;
  } catch (e) {}
}

async function persistPauseState() {
  if (!botStateCollection || !isDbConnected) return;
  try { await botStateCollection.updateOne({ _id: 'botControl' }, { $set: { isPaused } }, { upsert: true }); } catch (e) {}
}

let currentInstanceId = null;

async function tryAcquireLockOnce(instanceId) {
  try { await lockCollection.insertOne({ _id: 'instanceLock', instanceId: null, lastSeen: new Date(0) }); } catch (e) { if (e.code !== 11000) throw e; }
  const result = await lockCollection.updateOne(
    { _id: 'instanceLock', $or: [{ instanceId }, { lastSeen: { $lt: new Date(Date.now() - config.LOCK_STALE_AFTER_MS) } }] },
    { $set: { instanceId, lastSeen: new Date() } }
  );
  return result.matchedCount > 0;
}

async function acquireInstanceLock() {
  const instanceId = process.env.INSTANCE_ID || `primary-${process.pid}-${Date.now()}`;
  try {
    for (let attempt = 1; attempt <= config.LOCK_ACQUIRE_RETRIES; attempt++) {
      const acquired = await tryAcquireLockOnce(instanceId);
      if (acquired) { currentInstanceId = instanceId; return instanceId; }
      if (attempt < config.LOCK_ACQUIRE_RETRIES) await sleep(config.LOCK_ACQUIRE_RETRY_DELAY_MS);
    }
    logger.error('🔴 Konnte Instance-Lock nicht erwerben – beende Prozess.');
    await sendTelegramAlert('🚨 <b>Instance-Lock fehlgeschlagen!</b> Bot wird beendet.');
    process.exit(1);
  } catch (e) {
    logger.error('🔴 Kritischer Fehler beim Instance-Lock – beende Prozess.');
    await sendTelegramAlert('🚨 <b>Instance-Lock Fehler!</b> Bot wird beendet.');
    process.exit(1);
  }
}

async function releaseInstanceLock() {
  if (!lockCollection || !isDbConnected || !currentInstanceId) return;
  try { await lockCollection.updateOne({ _id: 'instanceLock', instanceId: currentInstanceId }, { $set: { instanceId: null, lastSeen: new Date(0) } }); } catch (e) {}
}

let lockHeartbeatInterval = null;
function startLockHeartbeat(instanceId) {
  if (lockHeartbeatInterval) return;
  lockHeartbeatInterval = setInterval(async () => {
    if (!isDbConnected || !lockCollection) return;
    try { await lockCollection.updateOne({ _id: 'instanceLock', instanceId }, { $set: { lastSeen: new Date() } }); } catch (e) {}
  }, 60_000);
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
    } catch (e) {}
  }
  logger.info(`⚙️ [FILTER CHANGE] ${filterKey} (${action}): ${oldValue} -> ${newValue}`);
}

async function initDatabase() {
  try {
    const startTime = Date.now();
    await client.connect();
    const db = client.db('tradingBotDB');
    tradesCollection = db.collection('activeTrades');
    closedTradesCollection = db.collection('closedTrades');
    botStateCollection = db.collection('botState');
    lockCollection = db.collection('locks');
    marketPhaseLogsCollection = db.collection('marketPhaseLogs');
    filterChangeLogCollection = db.collection('filterChangeLogs');
    isDbConnected = true;
    apiLatencyStats.record('mongodb', Date.now() - startTime);
    logger.info('✅ Datenbank erfolgreich verbunden');

    try {
      await tradesCollection.createIndex({ symbol: 1 }, { unique: true });
      await closedTradesCollection.createIndex({ closeTime: -1 });
      await closedTradesCollection.createIndex({ symbol: 1, closeTime: -1 });
      await marketPhaseLogsCollection.createIndex({ timestamp: -1 });
      await filterChangeLogCollection.createIndex({ timestamp: -1 });
    } catch (e) {}

    if (dbReconnectInterval) { clearInterval(dbReconnectInterval); dbReconnectInterval = null; }
    const instanceId = await acquireInstanceLock();
    startLockHeartbeat(instanceId);

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

    if (dbBulkTimer) clearInterval(dbBulkTimer);
    dbBulkTimer = setInterval(processDbBulkQueue, config.DB_BULK_INTERVAL_MS);
  } catch (e) {
    logger.error(`🔴 Datenbank-Verbindungsfehler: ${e.message}`);
    isDbConnected = false;
  }
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
  } catch (e) {}
}

async function persistDailyPnLState() {
  if (!botStateCollection || !isDbConnected) return;
  try { await botStateCollection.updateOne({ _id: 'dailyPnL' }, { $set: { value: dailyNetPnL, dateUTC: todayUTCString() } }, { upsert: true }); } catch (e) {}
}

async function persistPeakCapital() {
  if (!botStateCollection || !isDbConnected) return;
  try { await botStateCollection.updateOne({ _id: 'peakCapital' }, { $set: { value: peakCapital } }, { upsert: true }); } catch (e) {}
}

async function upsertTrade(symbol, tradeData) {
  activeTrades.set(symbol, tradeData);
  if (tradesCollection && isDbConnected) dbBulkQueue.push({ type: 'upsertTrade', symbol, data: tradeData });
}

async function removeTrade(symbol, closedTradeRecord = null) {
  const trade = activeTrades.get(symbol);
  if (trade) {
    const finalRecord = closedTradeRecord || { ...trade, closeTime: Date.now(), closeReason: 'manual/unknown' };
    await persistClosedTradeRecord(finalRecord);
    activeTrades.delete(symbol);
  }
  priceFailureCounts.delete(symbol);
  if (tradesCollection && isDbConnected) dbBulkQueue.push({ type: 'removeTrade', symbol });
}

async function persistClosedTradeRecord(record) {
  if (closedTradesCollection && isDbConnected) dbBulkQueue.push({ type: 'insertClosed', data: record });
  else pendingClosedTrades.push(record);
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
  } catch (e) {}
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
    isPaused = true;
    persistPauseState();
    persistPeakCapital();
    sendDeduplicatedAlert('global_drawdown', `🔴 <b>MAX DRAWDOWN ERREICHT: ${drawdown.toFixed(1)}%!</b>\nBot wurde pausiert.`);
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
    persistPauseState();
    sendDeduplicatedAlert('daily_profit_target', `🎯 <b>TÄGLICHES PROFIT-ZIEL ERREICHT!</b>\nProfit heute: $${dailyNetPnL.toFixed(2)}`);
    return true;
  }
  return false;
}

async function recordTradePnL(pnlUSD) {
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

function canOpenNewTrade(activeTradesCount, direction, notionalUSD = 0) {
  if (!isDbConnected) return { allowed: false, reason: 'skippedDbDisconnected' };
  if (activeTradesCount >= config.MAX_CONCURRENT_TRADES) return { allowed: false, reason: 'skippedMaxConcurrentTrades' };
  if (dailyNetPnL <= -config.MAX_DAILY_LOSS_USD) return { allowed: false, reason: 'skippedDailyLossLimit' };

  const currentEquity = config.CAPITAL_USD + dailyNetPnL;
  if (checkGlobalDrawdown(currentEquity)) return { allowed: false, reason: 'skippedMaxDrawdown' };

  if (direction) {
    const sameCount = [...activeTrades.values()].filter(t => t.direction === direction).length;
    if (sameCount >= config.MAX_SAME_DIRECTION) return { allowed: false, reason: 'skippedMaxSameDirection' };
  }

  const totalNotional = [...activeTrades.values()].reduce((sum, t) => sum + (t.notionalUSD || 0), 0) + notionalUSD;
  const totalMarginUSD = totalNotional / config.LEVERAGE;
  if (totalMarginUSD > config.CAPITAL_USD * config.MAX_EXPOSURE_RATIO) return { allowed: false, reason: 'skippedExposureLimit' };

  return { allowed: true, reason: null };
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
  const factor = side === 'entry'
    ? (direction === 'LONG' ? 1 + config.SLIPPAGE_PERCENT / 100 : 1 - config.SLIPPAGE_PERCENT / 100)
    : (direction === 'LONG' ? 1 - config.SLIPPAGE_PERCENT / 100 : 1 + config.SLIPPAGE_PERCENT / 100);
  return price * factor;
}

function applyFees(notional) { return notional * (config.FEE_PERCENT / 100); }

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
function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return prices ? prices[prices.length - 1] : 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateEMASeries(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  const series = new Array(values.length).fill(null);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    series[i] = ema;
  }
  return series;
}

function calculateRSI(prices, period = 14) {
  if (!prices || prices.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
    }
  }
  const rs = avgGain / (avgLoss === 0 ? 0.001 : avgLoss);
  return 100 - (100 / (1 + rs));
}

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 0;
  let tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateChoppinessIndex(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 50;
  const sample = candles.slice(-period);
  const highest = Math.max(...sample.map(c => c.high));
  const lowest = Math.min(...sample.map(c => c.low));
  let sumTR = 0;
  for (let i = 1; i < sample.length; i++) {
    sumTR += Math.max(sample[i].high - sample[i].low, Math.abs(sample[i].high - sample[i - 1].close), Math.abs(sample[i].low - sample[i - 1].close));
  }
  const range = highest - lowest;
  if (range === 0) return 50;
  return Number((100 * (Math.log10(sumTR / range) / Math.log10(period))).toFixed(1));
}

function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period * 2 + 10) return 0;
  let tr = [], pDM = [], mDM = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low;
    const prevClose = candles[i - 1].close, prevHigh = candles[i - 1].high, prevLow = candles[i - 1].low;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    const upMove = high - prevHigh, downMove = prevLow - low;
    pDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    mDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothpDM = pDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothmDM = mDM.slice(0, period).reduce((a, b) => a + b, 0);
  let dxList = [];
  for (let i = period; i < tr.length; i++) {
    smoothTR   = smoothTR   - smoothTR   / period + tr[i]   / period;
    smoothpDM  = smoothpDM  - smoothpDM  / period + pDM[i]  / period;
    smoothmDM  = smoothmDM  - smoothmDM  / period + mDM[i]  / period;
    const pDI = (smoothpDM / (smoothTR || 1)) * 100;
    const mDI = (smoothmDM / (smoothTR || 1)) * 100;
    const diDiff = Math.abs(pDI - mDI);
    const diSum = pDI + mDI;
    dxList.push(diSum === 0 ? 0 : (diDiff / diSum) * 100);
  }
  if (dxList.length < period) return 0;
  return Number((dxList.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(1));
}

function calculateHurstExponent(prices) {
  if (!prices || prices.length < 30) return 0.5;
  const l = prices.length;
  const logPrices = prices.map(p => Math.log(p));
  const returns = [];
  for (let i = 1; i < logPrices.length; i++) {
    returns.push(logPrices[i] - logPrices[i - 1]);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const deviations = returns.map(r => r - mean);
  const z = [];
  let cumSum = 0;
  for (const d of deviations) {
    cumSum += d;
    z.push(cumSum);
  }
  const maxZ = Math.max(...z);
  const minZ = Math.min(...z);
  const R = maxZ - minZ;
  
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const S = Math.sqrt(variance);
  if (S === 0 || R === 0) return 0.5;
  
  const rs = R / S;
  const hurst = Math.log(rs) / Math.log(l);
  return Number(Math.max(0, Math.min(1, hurst)).toFixed(3));
}

function calculateMACD(closes) {
  if (!closes || closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12Series = calculateEMASeries(closes, 12);
  const ema26Series = calculateEMASeries(closes, 26);
  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12Series[i] != null && ema26Series[i] != null) macdSeries.push(ema12Series[i] - ema26Series[i]);
  }
  if (macdSeries.length < 9) {
    const macdLine = macdSeries[macdSeries.length - 1] || 0;
    return { macd: macdLine, signal: 0, histogram: macdLine };
  }
  const signalSeries = calculateEMASeries(macdSeries, 9);
  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1] ?? 0;
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function calculateVWAP(candles) {
  if (!candles || candles.length === 0) return 0;
  const lastCandleDate = new Date(candles[candles.length - 1].time * 1000);
  const sessionStartUTC = Date.UTC(lastCandleDate.getUTCFullYear(), lastCandleDate.getUTCMonth(), lastCandleDate.getUTCDate()) / 1000;
  const sessionCandles = candles.filter(c => c.time >= sessionStartUTC);
  const workingSet = sessionCandles.length > 0 ? sessionCandles : candles;
  let cumulativeTPV = 0, cumulativeVolume = 0;
  for (const c of workingSet) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }
  return cumulativeVolume === 0 ? workingSet[workingSet.length - 1].close : Number((cumulativeTPV / cumulativeVolume).toFixed(4));
}

function calculateVolumeProfilePOC(candles, lookback = 30, binsCount = 20) {
  if (!candles || candles.length < lookback) return null;
  const sample = candles.slice(-lookback);
  let minPrice = Infinity, maxPrice = -Infinity;
  sample.forEach(c => { if (c.low < minPrice) minPrice = c.low; if (c.high > maxPrice) maxPrice = c.high; });
  const step = (maxPrice - minPrice) / binsCount;
  if (step === 0) return minPrice;
  const bins = new Array(binsCount).fill(0);
  sample.forEach(c => {
    const avgPrice = (c.high + c.low + c.close) / 3;
    const binIndex = Math.min(Math.floor((avgPrice - minPrice) / step), binsCount - 1);
    bins[binIndex] += c.volume;
  });
  let maxVolBin = 0, maxVol = 0;
  bins.forEach((vol, idx) => { if (vol > maxVol) { maxVol = vol; maxVolBin = idx; } });
  return Number((minPrice + (maxVolBin + 0.5) * step).toFixed(4));
}

function calculateRelativeVolume(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 1) return 1;
  const current = candles[candles.length - 1].volume;
  const previous = candles.slice(-lookback - 1, -1);
  const avgVolume = previous.reduce((a, c) => a + c.volume, 0) / previous.length;
  return avgVolume === 0 ? 1 : current / avgVolume;
}

function checkSwingBreakOfStructure(candles, lookback = 10) {
  if (!candles || candles.length < lookback + 2) return { bosBullish: false, bosBearish: false };
  const current = candles[candles.length - 1];
  const prevCandles = candles.slice(-lookback - 2, -2);
  const highestClose = Math.max(...prevCandles.map(c => c.close));
  const lowestClose = Math.min(...prevCandles.map(c => c.close));
  return { bosBullish: current.close > highestClose, bosBearish: current.close < lowestClose };
}

function calculateSignalScore(params) {
  let score = 0;
  score += Math.min(params.adx / 50, 1) * 30;
  const rsiOptimal = params.direction === 'LONG' ? 55 : 45;
  score += Math.max(0, (1 - Math.abs(params.rsi - rsiOptimal) / 30)) * 20;
  score += Math.min(params.relativeVolume / 2, 1) * 20;
  if (params.trend1h === (params.direction === 'LONG' ? 'BULLISH' : 'BEARISH')) score += 15;
  if (params.trend4h === (params.direction === 'LONG' ? 'BULLISH' : 'BEARISH')) score += 15;
  return Math.round(Math.min(score, 100));
}

// ==========================================
// 11. KUCOIN MARKET DATA
// ==========================================
const FUTURES_GRANULARITY_MINUTES = { '1d': 1440, '4h': 240, '1h': 60, '15m': 15, '5m': 5, '1m': 1 };

async function fetchKucoinKlines(symbol, timeframe = '15m', limit = 100) {
  const granularity = FUTURES_GRANULARITY_MINUTES[timeframe];
  if (!granularity) return null;
  const futuresSymbol = getFuturesSymbol(symbol);
  if (!futuresSymbol) return null;

  const to = Date.now();
  const from = to - (limit + 10) * granularity * 60_000;
  const url = `https://api-futures.kucoin.com/api/v1/kline/query?symbol=${futuresSymbol}&granularity=${granularity}&from=${from}&to=${to}`;

  try {
    const res = await futuresApiGetWithRetry(url, { timeout: 5000 });
    if (res.data && res.data.code === '200000' && Array.isArray(res.data.data)) {
      const context = `${futuresSymbol}/${timeframe}`;
      const candles = res.data.data.map(c => {
        const time = parseInt(c[0]);
        const open = safeParseFloat(c[1], 'open', context);
        const high = safeParseFloat(c[2], 'high', context);
        const low = safeParseFloat(c[3], 'low', context);
        const close = safeParseFloat(c[4], 'close', context);
        const volume = safeParseFloat(c[5], 'volume', context);
        if ([open, close, high, low, volume].some(v => v === null) || Number.isNaN(time)) return null;
        return { time, open, close, high, low, volume };
      }).filter(Boolean);
      return candles.slice(0, -1).slice(-limit);
    }
  } catch (e) {}
  return null;
}

function deriveHigherTimeframes(candles15m, targetTimeframe) {
  if (!candles15m || candles15m.length < 4) return null;
  const periods = { '1h': 4, '4h': 16, '1d': 96 };
  const period = periods[targetTimeframe];
  if (!period) return null;

  const derived = [];
  for (let i = period - 1; i < candles15m.length; i += period) {
    const slice = candles15m.slice(i - period + 1, i + 1);
    derived.push({
      time: slice[slice.length - 1].time,
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
  try {
    const futuresSymbol = getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/ticker?symbol=${futuresSymbol}`;
    const res = await futuresApiGetWithRetry(url, { timeout: 4000 });
    if (res.data?.code === '200000' && res.data.data?.price != null) {
      return safeParseFloat(res.data.data.price, 'tickerPrice', futuresSymbol);
    }
  } catch (e) {}
  return null;
}

async function fetchKucoinMarkPrice(symbol) {
  try {
    const futuresSymbol = getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/mark-price/${futuresSymbol}/current`;
    const res = await futuresApiGetWithRetry(url, { timeout: 4000 });
    if (res.data?.code === '200000' && res.data.data?.value != null) {
      return safeParseFloat(res.data.data.value, 'markPrice', futuresSymbol);
    }
  } catch (e) {}
  return null;
}

async function fetchFuturesData(symbol) {
  try {
    const futuresSymbol = getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/contracts/${futuresSymbol}`;
    const res = await futuresApiGetWithRetry(url, { timeout: 4000 });
    if (res.data?.code === '200000' && res.data.data) {
      const oi = safeParseFloat(res.data.data.openInterestVal ?? res.data.data.openInterest ?? 0, 'openInterest', symbol);
      const funding = safeParseFloat(res.data.data.fundingFeeRate ?? 0, 'fundingRate', symbol);
      return { openInterest: oi === null ? 0 : oi, fundingRate: funding === null ? 0 : funding };
    }
  } catch (e) {}
  return null;
}

async function fetchOrderBookMetrics(symbol) {
  try {
    const futuresSymbol = getFuturesSymbol(symbol);
    if (!futuresSymbol) return null;
    const url = `https://api-futures.kucoin.com/api/v1/level2/snapshot?symbol=${futuresSymbol}`;
    const res = await futuresApiGetWithRetry(url, { timeout: 3000 });
    if (res.data?.code === '200000' && res.data.data) {
      const bids = res.data.data.bids || [];
      const asks = res.data.data.asks || [];
      if (bids.length === 0 || asks.length === 0) return { spreadPct: 0, bidAskRatio: 1 };
      
      const bestBid = parseFloat(bids[0][0]);
      const bestAsk = parseFloat(asks[0][0]);
      const spreadPct = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 0;

      const depth = config.ORDERBOOK_DEPTH_LEVELS || 10;
      const bidVolume = bids.slice(0, depth).reduce((sum, [_, size]) => sum + parseFloat(size || 0), 0);
      const askVolume = asks.slice(0, depth).reduce((sum, [_, size]) => sum + parseFloat(size || 0), 0);
      const bidAskRatio = askVolume > 0 ? bidVolume / askVolume : 1;

      return { spreadPct, bidAskRatio };
    }
  } catch (e) {}
  return { spreadPct: 0, bidAskRatio: 1 };
}

const contractSpecsCache = new Map();

async function loadFuturesContractSpecs() {
  try {
    const url = 'https://api-futures.kucoin.com/api/v1/contracts/active';
    const res = await axiosGetWithRetry(url, { timeout: 8000 });
    if (res.data?.code === '200000' && Array.isArray(res.data.data)) {
      contractSpecsCache.clear();
      for (const c of res.data.data) {
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
    }
  } catch (e) {}
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
  const url = 'https://api.kucoin.com/api/v1/market/allTickers';
  const blacklist = ['USDC-USDT', 'FDUSD-USDT', 'TUSD-USDT', 'EUR-USDT', 'DAI-USDT', 'USDP-USDT', 'KCS-USDT', 'WBTC-USDT'];
  try {
    const res = await axiosGetWithRetry(url, { timeout: 6000 });
    if (res.data?.code === '200000' && res.data.data?.ticker) {
      return res.data.data.ticker
        .filter(item => item.symbol.endsWith('-USDT') && !blacklist.includes(item.symbol) && !item.symbol.includes('3L') && !item.symbol.includes('3S'))
        .sort((a, b) => parseFloat(b.volValue) - parseFloat(a.volValue))
        .slice(0, limit)
        .map(item => item.symbol);
    }
  } catch (e) {}
  return ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT'];
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
    try { await fetchKucoinKlinesCached(symbol, timeframe, limit); } catch (e) {}
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
  } catch (e) { return null; }
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
  } catch (e) { return null; }
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
  const lines = [`🔎 <b>SCAN-DIAGNOSE v21.5 (${escapeHtml(STRATEGY_PROFILE_NAME)})</b>`];
  lines.push(`Coins geprüft: ${stats.total} | Signale gesendet: ${stats.signalsSent}`);
  if (stats.avgSignalScore !== undefined) lines.push(`Ø Signal-Score: ${stats.avgSignalScore}/100`);
  lines.push(`Marktphase: ${currentMarketPhase}\n`);

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
  if (stats.mlBlocked) reasons.push(`TensorFlow.js ML-Filter blockiert: ${stats.mlBlocked}`);
  if (stats.geminiBlocked) reasons.push(`Gemini Risk Officer blockiert: ${stats.geminiBlocked}`);
  if (stats.hurstBlocked) reasons.push(`Hurst-Exponent (Zufallsmarkt): ${stats.hurstBlocked}`);
  if (stats.adxTooLow) reasons.push(`ADX zu niedrig: ${stats.adxTooLow}`);
  if (stats.marketChoppy) reasons.push(`Markt seitwärts (CHOP): ${stats.marketChoppy}`);
  if (stats.noBOS) reasons.push(`Kein BOS: ${stats.noBOS}`);
  if (stats.rsiTooLow) reasons.push(`RSI zu niedrig: ${stats.rsiTooLow}`);
  if (stats.rsiTooHigh) reasons.push(`RSI zu hoch: ${stats.rsiTooHigh}`);
  if (stats.pocVwapFail) reasons.push(`POC/VWAP nicht erfüllt: ${stats.pocVwapFail}`);
  if (stats.macdFail) reasons.push(`MACD unpassend: ${stats.macdFail}`);
  if (stats.fundingBlocked) reasons.push(`Funding-Rate blockiert: ${stats.fundingBlocked}`);
  if (stats.relVolTooLow) reasons.push(`Volumen zu niedrig: ${stats.relVolTooLow}`);
  if (stats.correlationBlocked) reasons.push(`Korrelations-Limit: ${stats.correlationBlocked}`);
  if (stats.orderBookBlocked) reasons.push(`Orderbuch Imbalance: ${stats.orderBookBlocked}`);
  if (stats.spreadTooHigh) reasons.push(`Orderbuch Spread zu hoch: ${stats.spreadTooHigh}`);
  if (stats.cooldownActive) reasons.push(`Signal-Cooldown aktiv: ${stats.cooldownActive}`);
  if (stats.positionTooSmallForLot) reasons.push(`Position zu klein für Min-Lot: ${stats.positionTooSmallForLot}`);

  if (reasons.length > 0) {
    lines.push(`<b>Ausschlussgründe:</b>`);
    reasons.forEach(r => lines.push(`• ${r}`));
  }

  const accountedFor = (stats.signalsSent || 0) +
    (stats.missingKlines || 0) +
    (stats.skippedActiveTrade || 0) +
    (stats.skippedMaxSignals || 0) +
    (stats.skippedDynamicBlacklist || 0) +
    (stats.mlBlocked || 0) +
    (stats.geminiBlocked || 0) +
    (stats.hurstBlocked || 0) +
    (stats.adxTooLow || 0) +
    (stats.marketChoppy || 0) +
    (stats.noBOS || 0) +
    (stats.rsiTooLow || 0) +
    (stats.rsiTooHigh || 0) +
    (stats.pocVwapFail || 0) +
    (stats.macdFail || 0) +
    (stats.fundingBlocked || 0) +
    (stats.relVolTooLow || 0) +
    (stats.correlationBlocked || 0) +
    (stats.orderBookBlocked || 0) +
    (stats.spreadTooHigh || 0) +
    (stats.signalHistoryBlocked || 0) +
    (stats.cooldownActive || 0) +
    (stats.positionTooSmallForLot || 0) +
    (stats.skippedDbDisconnected || 0) +
    (stats.skippedMaxConcurrentTrades || 0) +
    (stats.skippedDailyLossLimit || 0) +
    (stats.skippedMaxSameDirection || 0) +
    (stats.skippedExposureLimit || 0) +
    (stats.skippedMaxDrawdown || 0) +
    (stats.btcCounterTrendBlocked || 0) +
    trendTotal;

  const unaccounted = stats.total - accountedFor;
  if (unaccounted > 0) {
    lines.push(`\n⚠️ <b>Unklare Verwerfungen:</b> ${unaccounted} Coins`);
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
// 15. TRACKER SCHLEIFE
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

async function checkActiveTrades() {
  if (trackerLock) {
    if (!trackerTimeout) {
      trackerTimeout = setTimeout(() => { trackerLock = false; trackerTimeout = null; }, 120000);
    }
    return;
  }
  trackerLock = true;

  try {
    if (trackerTimeout) { clearTimeout(trackerTimeout); trackerTimeout = null; }
    lastTrackerCheckTime = Date.now();
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

        if (!trade.tp1Hit && hoursElapsed >= trade.maxHoldHours) {
          const exitPrice = applySlippage(currentPrice, trade.direction, 'exit');
          const pnlPerUnit = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
          const pnlUSD = pnlPerUnit * (trade.positionSizeUnits || 0) - applyFees(trade.notionalUSD) - remainingEntryFee - fundingCostSoFar;
          await recordTradePnL(pnlUSD);
          await sendTelegramAlert(`⌛ <b>TIME-STOP: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
          await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'time-stop', pnlUSD, exitPrice });
          continue;
        }

        if (trade.tp1Hit && hoursElapsed >= config.ABSOLUTE_MAX_HOLD_HOURS) {
          const exitPrice = applySlippage(currentPrice, trade.direction, 'exit');
          const pnlPerUnit = trade.direction === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice;
          const pnlUSD = pnlPerUnit * trade.positionSizeUnits - applyFees(trade.notionalUSD) - remainingEntryFee - fundingCostSoFar;
          await recordTradePnL(pnlUSD);
          await sendTelegramAlert(`⌛ <b>ABSOLUTES ZEITLIMIT: ${cleanSymbol}/USDT</b> PnL: $${pnlUSD.toFixed(2)}`);
          await removeTrade(symbol, { symbol, direction: trade.direction, closeTime: Date.now(), closeReason: 'absolute-time-limit', pnlUSD, exitPrice });
          continue;
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
            const partialPnl = (exitPrice - trade.entry) * partialUnits - applyFees(trade.notionalUSD * config.TP1_CLOSE_PERCENT / 100) - partialEntryFee - partialFundingCost;

            trade.positionSizeUnits -= partialUnits;
            trade.partiallyClosed = true;
            trade.notionalUSD = trade.positionSizeUnits * trade.entry;
            trade.entryFeePaidUSD = (trade.entryFeePaidUSD || 0) + partialEntryFee;
            trade.fundingCostUSD = fundingCostSoFar - partialFundingCost;
            trade.stopLoss = trade.entry;
            trade.highestSinceTP1 = exitPrice;

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
            const partialPnl = (trade.entry - exitPrice) * partialUnits - applyFees(trade.notionalUSD * config.TP1_CLOSE_PERCENT / 100) - partialEntryFee - partialFundingCost;

            trade.positionSizeUnits -= partialUnits;
            trade.partiallyClosed = true;
            trade.notionalUSD = trade.positionSizeUnits * trade.entry;
            trade.entryFeePaidUSD = (trade.entryFeePaidUSD || 0) + partialEntryFee;
            trade.fundingCostUSD = fundingCostSoFar - partialFundingCost;
            trade.stopLoss = trade.entry;
            trade.lowestSinceTP1 = exitPrice;

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

async function asyncPool(concurrency, items, iteratorFn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    results.push(p);
    if (concurrency <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

function evaluateDirectionGates(dir, p) {
  const isLong = dir === 'LONG';

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

  if (filterState.adx.enabled) {
    const effectiveADX = p.adaptiveADX || config.ADX_MIN;
    if (p.adx < effectiveADX) return 'adxTooLow';
  }

  if (filterState.hurst.enabled) {
    if (p.hurst < config.MIN_HURST_EXPONENT) return 'hurstBlocked';
  }

  if (filterState.chop.enabled) {
    if (p.chop && p.chop > config.MAX_CHOP_INDEX) return 'marketChoppy';
  }

  if (filterState.bos.enabled) {
    const bos = isLong ? p.bosBullish : p.bosBearish;
    if (!bos) return 'noBOS';
  }

  if (isLong) {
    if (filterState.rsi_long_min.enabled && p.rsi < config.RSI_LONG_MIN) return 'rsiTooLow';
    if (p.rsi > config.RSI_LONG_MAX) return 'rsiTooHigh';
  } else {
    if (p.rsi < config.RSI_SHORT_MIN) return 'rsiTooLow';
    if (filterState.rsi_short_max.enabled && p.rsi > config.RSI_SHORT_MAX) return 'rsiTooHigh';
  }

  const priceOk = p.poc && p.vwap && (isLong ? (p.currentPrice >= p.poc && p.currentPrice >= p.vwap) : (p.currentPrice <= p.poc && p.currentPrice <= p.vwap));
  if (!priceOk) return 'pocVwapFail';

  const macdOk = isLong ? p.macd.histogram >= 0 : p.macd.histogram <= 0;
  if (!macdOk) return 'macdFail';

  const fundingOk = isLong ? p.fundingRate <= config.MAX_FUNDING_RATE : p.fundingRate >= config.MIN_FUNDING_RATE;
  if (!fundingOk) return 'fundingBlocked';

  if (filterState.relvol.enabled) {
    const effectiveVolume = p.adaptiveVolume || config.MIN_RELATIVE_VOLUME;
    if (effectiveVolume > 0 && p.relativeVolume < effectiveVolume) return 'relVolTooLow';
  }

  return null;
}

function createEmptyScanStats() {
  return {
    total: 0, signalsSent: 0, totalSignalScore: 0, avgSignalScore: 0,
    skippedActiveTrade: 0, skippedMaxSignals: 0, skippedDbDisconnected: 0,
    skippedMaxConcurrentTrades: 0, skippedDailyLossLimit: 0, skippedMaxSameDirection: 0,
    skippedExposureLimit: 0, skippedMaxDrawdown: 0, missingKlines: 0,
    trendMismatch: 0, trendMismatch1h: 0, trendMismatch4h: 0,
    btcCounterTrendBlocked: 0, adxTooLow: 0, hurstBlocked: 0, marketChoppy: 0, noBOS: 0, rsiOutOfRange: 0,
    rsiTooLow: 0, rsiTooHigh: 0, pocVwapFail: 0, macdFail: 0, fundingBlocked: 0,
    relVolTooLow: 0, cooldownActive: 0, positionTooSmallForLot: 0, correlationBlocked: 0,
    orderBookBlocked: 0, spreadTooHigh: 0, signalHistoryBlocked: 0, skippedDynamicBlacklist: 0,
    mlBlocked: 0, geminiBlocked: 0
  };
}

let isScanning = false;

async function scanMarket() {
  if (isScanning) return;
  isScanning = true;
  lastScanTime = Date.now();
  logger.info(`[${new Date().toISOString().slice(0, 16)}] 🔍 Starte Scan v21.5...`);

  if (!isDbConnected || isPaused) {
    logger.warn(`⚠️ Scan abgebrochen: DB=${isDbConnected}, Paused=${isPaused}`);
    isScanning = false;
    return;
  }

  const scanStats = createEmptyScanStats();
  const signalBatch = [];

  try {
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

    let adaptiveRisk = config.RISK_PERCENT;
    if (config.ENABLE_KELLY_SIZING) {
      const weekStats = await getPeriodPerformanceStats(7).catch(() => null);
      if (weekStats && weekStats.totalTrades >= 20) {
        adaptiveRisk = calculateKellyRisk(
          parseFloat(weekStats.winRate), 
          weekStats.avgWin, 
          Math.abs(weekStats.avgLoss), 
          config.RISK_PERCENT
        ) * 100;
      }
    }

    logger.info(`📊 Phase: ${currentMarketPhase} | ADX: ${adaptiveADX.toFixed(1)} | Risk: ${adaptiveRisk.toFixed(2)}%`);

    const spotWatchlist = await getTopKucoinPairs(config.TOP_COIN_LIMIT).catch(() => ['BTC-USDT', 'ETH-USDT']);
    const dynamicWatchlist = contractSpecsCache.size > 0 
      ? spotWatchlist.filter(isFuturesContractTradable) 
      : spotWatchlist;

    if (dynamicWatchlist.length === 0) {
      logger.warn('⚠️ Watchlist ist leer!');
      isScanning = false;
      return;
    }

    if (config.ENABLE_PRELOADING) {
      preloadKlines(dynamicWatchlist.slice(0, 20), '15m', 100);
    }

    let signalsSent = 0;

    await asyncPool(config.SCAN_CONCURRENCY, dynamicWatchlist, async (symbol) => {
      scanStats.total++;

      if (activeTrades.has(symbol)) { 
        scanStats.skippedActiveTrade++; 
        return; 
      }

      if (await isCoinDynamicallyBlacklisted(symbol)) {
        scanStats.skippedDynamicBlacklist++;
        return;
      }

      if (signalsSent >= config.MAX_SIGNALS_PER_SCAN) { 
        scanStats.skippedMaxSignals++; 
        return; 
      }

      const preCheck = canOpenNewTrade(activeTrades.size, null);
      if (!preCheck.allowed) {
        if (preCheck.reason && scanStats.hasOwnProperty(preCheck.reason)) {
          scanStats[preCheck.reason]++;
        } else {
          scanStats.skippedActiveTrade++;
        }
        return;
      }

      try {
        const raw15m = await fetchKucoinKlinesCached(symbol, '15m', 100);
        if (!raw15m || raw15m.length < 20) { 
          scanStats.missingKlines++; 
          return; 
        }

        const raw1h = config.ENABLE_MULTI_TF_DERIVATION 
          ? deriveHigherTimeframes(raw15m, '1h') 
          : await fetchKucoinKlinesCached(symbol, '1h', 50);

        if (!raw1h) { 
          scanStats.missingKlines++; 
          return; 
        }

        let raw4h = null;
        if (config.REQUIRE_4H_TREND) {
          if (config.ENABLE_MULTI_TF_DERIVATION) {
            raw4h = deriveHigherTimeframes(raw15m, '4h');
            if (!raw4h || raw4h.length < 30) {
              raw4h = await fetchKucoinKlinesCached(symbol, '4h', 50);
            }
          } else {
            raw4h = await fetchKucoinKlinesCached(symbol, '4h', 50);
          }
        }

        const futuresData = await fetchFuturesData(symbol).catch(() => null);
        const orderBookMetrics = await fetchOrderBookMetrics(symbol).catch(() => ({ spreadPct: 0, bidAskRatio: 1 }));

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

        var direction = null;
        const primaryDir = trend1h === 'BULLISH' ? 'LONG' : 'SHORT';
        let primaryFail = evaluateDirectionGates(primaryDir, gateParams);

        if (!primaryFail) {
          direction = primaryDir;
        } else if (config.ENABLE_SHORT_SIGNALS || primaryDir === 'LONG') {
          const secondaryFail = evaluateDirectionGates(
            primaryDir === 'LONG' ? 'SHORT' : 'LONG', 
            gateParams
          );
          if (!secondaryFail) {
            direction = primaryDir === 'LONG' ? 'SHORT' : 'LONG';
          } else {
            scanStats[primaryFail] = (scanStats[primaryFail] || 0) + 1;
          }
        } else {
          scanStats[primaryFail] = (scanStats[primaryFail] || 0) + 1;
        }

        if (direction !== null) {
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
            adx, rsi, relativeVolume, trend1h, trend4h, direction
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

          if (shouldSkipSignal(symbol, direction, signalScore)) {
            scanStats.signalHistoryBlocked++;
            return;
          }

          // ==========================================
          // NEU: GEMINI RISIKO-CHECK ALS FINALE HÜRDE
          // ==========================================
          const geminiCheck = await evaluateSignalWithGemini(symbol, direction, signalScore, currentMarketPhase, mlPrediction.probability);
          if (!geminiCheck.approved) {
            logger.info(`🤖 [Gemini Risk Officer] Signal für ${symbol} (${direction}) abgelehnt: ${geminiCheck.reason}`);
            scanStats.geminiBlocked++;
            return;
          }

          const entryPrice = applySlippage(currentPrice, direction, 'entry');
          const stopDistance = atr * adaptiveATR;
          const stopLoss = direction === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;
          const tp1 = direction === 'LONG' ? entryPrice + (stopDistance * adaptiveTP1) : entryPrice - (stopDistance * adaptiveTP1);
          const tp2 = direction === 'LONG' ? entryPrice + (stopDistance * config.TP2_MULT) : entryPrice - (stopDistance * config.TP2_MULT);

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

          const finalCheck = canOpenNewTrade(activeTrades.size, direction, sizing.notionalUSD);
          if (!finalCheck.allowed) {
            scanStats[finalCheck.reason] = (scanStats[finalCheck.reason] || 0) + 1;
            return;
          }

          await persistAlertHistoryEntry(cooldownKey, Date.now());
          signalsSent++;
          scanStats.signalsSent++;
          scanStats.totalSignalScore += signalScore;

          const dynamicLeverage = calculateDynamicLeverage(atr, currentPrice, config.LEVERAGE);

          await upsertTrade(symbol, {
            symbol, direction, entry: entryPrice, stopLoss, tp1, tp2,
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
            mlProbabilityAtEntry: mlPrediction.probability,
            mlConfidenceAtEntry: mlPrediction.confidence,
            mlModelVersionAtEntry: mlModel.getStats().modelVersion || null
          });

          const safeSymbol = escapeHtml(symbol);
          const signalText = 
            `🚀 <b>NEUES SIGNAL: ${safeSymbol} (${direction})</b> [Score: ${signalScore}/100]\n` +
            `Entry: $${entryPrice.toFixed(6)} | SL: $${stopLoss.toFixed(6)}\n` +
            `TP1: $${tp1.toFixed(6)} | TP2: $${tp2.toFixed(6)}\n` +
            `Größe: ${sizing.contracts} Kontrakte | Risk: $${sizing.riskAmountUSD.toFixed(2)}\n` +
            `ADX: ${adx} | Hurst: ${hurst} | RSI: ${rsi.toFixed(1)} | Phase: ${currentMarketPhase}\n` +
            `🧠 TensorFlow.js: ${mlPrediction.trained ? (mlPrediction.probability * 100).toFixed(1) + '% Erfolgswahrscheinlichkeit' : 'noch nicht trainiert'}\n` +
            `🤖 Gemini Risk Officer: Freigegeben (${geminiCheck.reason})`;

          if (config.ENABLE_BATCH_SIGNALS) {
            signalBatch.push({ text: signalText });
          } else {
            await sendTelegramAlert(signalText);
          }
        }
      } catch (e) {
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

    if (scanCounter % config.SCAN_STATS_TELEGRAM_EVERY_N_SCANS === 0) {
      await sendTelegramAlert(formatScanStatsReport(scanStats));
    }

    await checkRiskLevels();

  } catch (err) {
    logger.error(`[SCAN CRITICAL ERROR] ${err.message}`);
    logger.error(err.stack);
  } finally {
    isScanning = false;
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
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  if (command === '/help' || command === '/start') {
    await sendTelegramReply(chatId,
      `<b>🤖 TRADING BOT v21.5 - MODULARES CONTROL SYSTEM</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>⚙️ DYNAMISCHE FILTER-STEUERUNG:</b>\n` +
      `/filters - Zeigt alle Indikator-Status & Werte an\n` +
      `/filter on/off [key] - Filter aktivieren/deaktivieren\n` +
      `/filter soft/hard [key] - Schwelle weicher/härter stellen\n` +
      `/filter reset [key] - Einen Filter auf Standard zurücksetzen\n` +
      `/filter reset all confirm - ALLE Filter auf Profil-Standard\n\n` +
      `<b>📊 Performance & Status:</b>\n` +
      `/stats - Performance heute (UTC)\n` +
      `/week - 7-Tage Performance Report\n` +
      `/month - 30-Tage Performance Report\n` +
      `/status - Gesamt-Status des Bots\n` +
      `/db - MongoDB Verbindungs-Check\n` +
      `/scanstats - Scan-Diagnose & Filter\n` +
      `/logs - Letzte 15 System-Logs anzeigen\n\n` +
      `<b>🤖 Künstliche Intelligenz (Gemini):</b>\n` +
      `/ki [Frage] - Marktanalyse per KI abfragen\n` +
      `/report - Automatisches KI-Trading Briefing\n\n` +
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
      `<b>🚫 Blacklist & KI:</b>\n` +
      `/blacklist / /unblacklist [Symbol] - Coins verwalten\n` +
      `/showblacklist - Gesperrte Coins auflisten\n` +
      `/retrain - TensorFlow.js KI neu trainieren\n\n` +
      `<b>🎮 System:</b>\n` +
      `/pause | /resume | /scan | /backtest [Symbol] [Days]`
    );
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
      report += `• Ausgeführte Trades: ${result.trades} (Win-Rate: ${m.winRate.toFixed(2)}%)\n`;
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
    await sendTelegramReply(chatId, '🧠 <i>Starte manuelles TensorFlow.js KI-Training...</i>');
    const res = await trainSignalMLModel(true);
    if (res.trained) {
      await sendTelegramReply(chatId, `🟢 <b>KI-Training erfolgreich!</b>\nSamples: ${res.samples} | Epochs: ${res.epochs}`);
    } else {
      await sendTelegramReply(chatId, `⚠️ <b>KI-Training nicht durchgeführt:</b> ${escapeHtml(res.reason)}`);
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

  if (command === '/status') {
    const lines = [];
    lines.push(`🤖 <b>BOT STATUS v21.5 ULTIMATE TFJS</b>`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Profil: ${escapeHtml(STRATEGY_PROFILE_NAME)} | Phase: ${currentMarketPhase}`);
    lines.push(`DB: ${isDbConnected ? '✅ verbunden' : '🔴 GETRENNT'}`);
    const mlStats = mlModel.getStats();
    lines.push(`ML: ${isModelTrained ? '🟢 TensorFlow.js aktiv' : '🟡 nicht trainiert'} | Samples: ${mlStats.samples || 0} | Acc: ${mlStats.validationAccuracy ? (mlStats.validationAccuracy * 100).toFixed(1) + '%' : 'n/a'}`);
    lines.push(`Scans: ${isPaused ? '⏸️ PAUSIERT' : '▶️ aktiv'}`);
    lines.push(`Kapital: $${config.CAPITAL_USD.toFixed(0)} | Peak: $${peakCapital.toFixed(0)}`);
    lines.push(`Hebel: ${config.LEVERAGE}x | Risk/Trade: ${config.RISK_PERCENT}%`);
    lines.push(`Offene Trades: ${activeTrades.size}/${config.MAX_CONCURRENT_TRADES}`);
    lines.push(`Heutige Netto-PnL: $${dailyNetPnL.toFixed(2)}`);
    
    const currentEquity = config.CAPITAL_USD + dailyNetPnL;
    const drawdownPercent = peakCapital > 0 ? ((peakCapital - currentEquity) / peakCapital * 100).toFixed(1) : 0;
    lines.push(`Drawdown: ${drawdownPercent}%`);
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
        try { await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook`); } catch (e2) {}
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
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`🤖 Trading Bot v21.5 ULTIMATE TFJS | Phase: ${currentMarketPhase} | DB: ${isDbConnected ? '✅' : '🔴'}`);
});

app.get('/health', (req, res) => {
  const currentEquity = config.CAPITAL_USD + dailyNetPnL;
  const drawdownPercent = peakCapital > 0 ? ((peakCapital - currentEquity) / peakCapital * 100).toFixed(1) : '0';
  res.status(isDbConnected ? 200 : 503).json({
    status: isDbConnected ? 'ok' : 'degraded', version: '21.5', dbConnected: isDbConnected,
    isPaused, activeTrades: activeTrades.size, dailyPnL: dailyNetPnL, currentEquity, peakCapital, drawdownPercent
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
    `bot_kucoin_errors ${kucoinErrorCount}`
  ].join('\n');
  res.setHeader('Content-Type', 'text/plain');
  res.send(metrics);
});

app.get('/backtest', async (req, res) => {
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

app.get('/api/ml/status', (req, res) => {
  res.json({
    enabled: config.ML_ENABLED,
    trained: isModelTrained,
    ...mlModel.getStats()
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

intervalTimers.push(setInterval(async () => { await checkActiveTrades(); }, config.FAST_TRACK_INTERVAL_SECONDS * 1000));
intervalTimers.push(setInterval(() => { klinesCache.cleanup(config.CACHE_CLEANUP_MINUTES * 60 * 1000); }, config.CACHE_CLEANUP_MINUTES * 60 * 1000));

cronJobs.push(cron.schedule('59 23 * * *', async () => {
  dailyNetPnL = 0;
  currentStreak = 0;
  await persistDailyPnLState();
}, { timezone: 'UTC' }));

cronJobs.push(cron.schedule('0 */6 * * *', async () => {
  await loadFuturesContractSpecs();
  await trainSignalMLModel();
}, { timezone: 'UTC' }));

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cronJobs.forEach(j => j.stop());
  intervalTimers.forEach(t => clearInterval(t));
  if (dbBulkTimer) clearInterval(dbBulkTimer);
  if (lockHeartbeatInterval) clearInterval(lockHeartbeatInterval);
  await processDbBulkQueue();
  server.close();
  await releaseInstanceLock();
  try { await client.close(); } catch (e) {}
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
  logger.info('🚀 Starte Trading Bot v21.5 ULTIMATE TFJS (Full Features, TensorFlow.js ML, Hurst Filter & Dynamic Filter Engine)...');
  
  await initDatabase();
  await loadFuturesContractSpecs();
  await loadSignalMLModel();
  if (!isModelTrained) await trainSignalMLModel(true);
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
  setInterval(runScanCycle, SCAN_INTERVAL_MS);
  
  logger.info(`🔄 Bot-Dauerschleife aktiv. Nächster Scan in ${SCAN_INTERVAL_MS / 60000} Minuten.`);
})();
