/**
 * Einstiegspunkt des optimierten Trading-Signal-Bots mit Anti-Blockade-Pool
 */
'use strict';

require('dotenv').config();
const SignalBotCore = require('./src/core/botCore');

const bot = new SignalBotCore({
    symbol: process.env.SYMBOL || 'RENDER-USDT',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000,
    maxHistorySize: parseInt(process.env.MAX_HISTORY_SIZE, 10) || 500,
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 10000
});

bot.start().catch(err => {
    console.error('[Fatal Error]', err);
    process.exit(1);
});
