/**
 * Gehärteter Kern-Controller für den Trading-Signal-Bot
 */
'use strict';

const EventEmitter = require('events');

class SignalBotCore extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = Object.assign({
            symbol: 'BTCUSDT',
            maxHistorySize: 500,
            pollIntervalMs: 5000
        }, config);

        this.marketDataBuffer = [];
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[SignalBot] Starte Signal-Bot Kern für ${this.config.symbol}...`);

        while (this.isRunning) {
            try {
                const rawData = await this.fetchMarketDataWithRetry();
                if (rawData) {
                    this.processDataPoint(rawData);
                    const signal = this.evaluateSignals();
                    if (signal && signal.type !== 'NEUTRAL') {
                        this.emit('signal', signal);
                    }
                }
            } catch (error) {
                console.error(`[SignalBot Error] Fehler im Hauptlauf: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
        }
    }

    stop() {
        this.isRunning = false;
        console.log('[SignalBot] Bot gestoppt.');
    }

    async fetchMarketDataWithRetry(retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const mockPrice = 50000 + Math.random() * 200 - 100;
                const mockVolume = Math.random() * 15;
                return {
                    timestamp: Date.now(),
                    price: parseFloat(mockPrice.toFixed(2)),
                    volume: parseFloat(mockVolume.toFixed(4)),
                    bid: parseFloat((mockPrice - 0.5).toFixed(2)),
                    ask: parseFloat((mockPrice + 0.5).toFixed(2))
                };
            } catch (err) {
                if (i === retries - 1) throw err;
                await new Promise(res => setTimeout(res, 1000 * (i + 1)));
            }
        }
        return null;
    }

    processDataPoint(data) {
        this.marketDataBuffer.push(data);
        if (this.marketDataBuffer.length > this.config.maxHistorySize) {
            this.marketDataBuffer.shift();
        }
    }

    evaluateSignals() {
        if (this.marketDataBuffer.length < 20) return null;

        const prices = this.marketDataBuffer.map(d => d.price);
        const volumes = this.marketDataBuffer.map(d => d.volume);

        const smaFast = this.calculateSMA(prices, 5);
        const smaSlow = this.calculateSMA(prices, 20);

        const totalVolume = volumes.reduce((acc, v) => acc + v, 0);
        const avgVolume = totalVolume / (volumes.length || 1);

        if (avgVolume === 0) {
            return { type: 'NEUTRAL', reason: 'Zero volume detected' };
        }

        let signalType = 'NEUTRAL';
        const currentPrice = prices[prices.length - 1];

        if (smaFast > smaSlow && currentPrice > smaFast) {
            signalType = 'BUY_SIGNAL';
        } else if (smaFast < smaSlow && currentPrice < smaFast) {
            signalType = 'SELL_SIGNAL';
        }

        return {
            timestamp: Date.now(),
            symbol: this.config.symbol,
            type: signalType,
            price: currentPrice,
            indicators: { smaFast, smaSlow, avgVolume }
        };
    }

    calculateSMA(data, period) {
        if (!data || data.length === 0 || period <= 0) return 0;
        const slice = data.slice(-period);
        const sum = slice.reduce((acc, val) => acc + val, 0);
        return parseFloat((sum / slice.length).toFixed(2));
    }
}

module.exports = SignalBotCore;
