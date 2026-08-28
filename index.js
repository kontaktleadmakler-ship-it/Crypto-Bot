/**
 * Einstiegspunkt des optimierten Trading-Signal-Bots
 */
'use strict';

require('dotenv').config();
const SignalBotCore = require('./src/core/botCore');
const MacroFilter = require('./src/modules/macroFilter');
const VolatilitySurface = require('./src/modules/volatilitySurface');
const OrderFlowAnalyzer = require('./src/modules/orderFlowAnalyzer');
const HedgeManager = require('./src/modules/hedgeManager');

const bot = new SignalBotCore({
    symbol: process.env.SYMBOL || 'BTCUSDT',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS, 10) || 5000,
    maxHistorySize: parseInt(process.env.MAX_HISTORY_SIZE, 10) || 500
});

// Module initialisieren
const macro = new MacroFilter();
const volSurface = new VolatilitySurface();
const orderFlow = new OrderFlowAnalyzer();
const hedge = new HedgeManager();

bot.on('signal', (signal) => {
    console.log(`
[SIGNAL EMPFANGEN] --->`, JSON.stringify(signal, null, 2));
    
    // Module einbinden
    const macroCheck = macro.evaluate();
    const volCheck = volSurface.calculate(signal.price);
    const flowCheck = orderFlow.analyze(signal.indicators);
    const hedgeRec = hedge.calculateHedge(signal);

    console.log(`[Modul-Check] Macro: ${macroCheck} | Volatility: ${volCheck.status} | OrderFlow: ${flowCheck} | Hedge: ${hedgeRec.action}`);
});

bot.start().catch(err => {
    console.error('[Fatal Error]', err);
    process.exit(1);
});
