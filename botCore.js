/**
 * Gehärteter Kern-Controller mit asyncPool Timeout-Schutz und Fallbacks
 */
'use strict';

const EventEmitter = require('events');
const asyncPool = require('./asyncPool');

class SignalBotCore extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = Object.assign({
            symbol: 'RENDER-USDT',
            maxHistorySize: 500,
            pollIntervalMs: 5000,
            requestTimeoutMs: 10000
        }, config);

        this.marketDataBuffer = [];
        this.isRunning = false;
        this.lastValidData = null;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[SignalBot] Starte Signal-Bot Kern für ${this.config.symbol} mit Timeout-Schutz...`);

        while (this.isRunning) {
            try {
                // Parallele Tasks über den sicheren asyncPool verarbeiten
                const tasks = [this.config.symbol];
                await asyncPool(1, tasks, async (symbol, { signal }) => {
                    return await this.fetchMarketDataWithFallback(symbol, { signal });
                }, this.config.requestTimeoutMs);

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

    /**
     * Marktdaten-Abruf mit integriertem Fallback und Signal-Unterstützung
     */
    async fetchMarketDataWithFallback(symbol, options = {}) {
        try {
            // Prüfen ob Abort bereits signalisiert wurde
            if (options.signal && options.signal.aborted) {
                throw new Error('Aborted');
            }

            // Simulierter Fetch (könnte echte API sein)
            // Hier greift der Timeout des asyncPools, falls es hängt
            const mockPrice = 5.50 + (Math.random() * 0.2 - 0.1);
            const mockVolume = Math.random() * 1500;

            const data = {
                timestamp: Date.now(),
                symbol: symbol,
                price: parseFloat(mockPrice.toFixed(4)),
                volume: parseFloat(mockVolume.toFixed(2)),
                fallback: false
            };

            this.lastValidData = data;
            this.processDataPoint(data);
            return data;

        } catch (error) {
            console.warn(`[MARKET-DATA] Warnung: Konnte Live-Daten für ${symbol} nicht laden (${error.message}). Verwende Fallback.`);
            
            // Fallback auf letzte bekannte Daten oder sichere Defaults
            const fallbackData = this.lastValidData || {
                timestamp: Date.now(),
                symbol: symbol,
                price: 0,
                volume: 0,
                fallback: true
            };

            this.processDataPoint(fallbackData);
            return fallbackData;
        }
    }

    processDataPoint(data) {
        this.marketDataBuffer.push(data);
        if (this.marketDataBuffer.length > this.config.maxHistorySize) {
            this.marketDataBuffer.shift();
        }
        console.log(`[Data Processed] ${data.symbol} - Preis: ${data.price} (Fallback: ${data.fallback})`);
    }
}

module.exports = SignalBotCore;
