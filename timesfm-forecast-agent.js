'use strict';

const { spawn } = require('child_process');
const path = require('path');

/**
 * Node adapter for the persistent TimesFM 2.5 Python worker.
 * Fail-open to the existing deterministic time-stop logic: if Python/Torch/
 * TimesFM is unavailable, no forecast is allowed to block risk management.
 */
class TimesFMForecastAgent {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.script = options.script || path.join(__dirname, 'timesfm_forecast_service.py');
    this.python = options.python || process.env.TIMESFM_PYTHON || 'python3';
    this.model = options.model || process.env.TIMESFM_MODEL || 'google/timesfm-2.5-200m-transformers';
    this.timeoutMs = Number(options.timeoutMs || process.env.TIMESFM_TIMEOUT_MS || 15000);
    this.logger = options.logger || console;
    this.proc = null;
    this.buffer = '';
    this.pending = new Map();
    this.requestSeq = 0;
    this.startPromise = null;
    this.stats = { requests: 0, successful: 0, errors: 0, timeouts: 0, lastSuccessAt: null, lastLatencyMs: null, modelReadyAt: null };
  }

  async start() {
    if (!this.enabled) return false;
    if (this.proc && !this.proc.killed) return true;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const proc = spawn(this.python, [this.script], {
        env: { ...process.env, TIMESFM_MODEL: this.model },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      this.proc = proc;
      let settled = false;
      const finish = (ok, err) => { if (!settled) { settled = true; ok ? resolve(true) : reject(err); } };
      proc.stdout.on('data', chunk => {
        this.buffer += chunk.toString();
        let idx;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { this.stats.modelReadyAt = Date.now(); finish(true); continue; }
          const waiter = msg && msg.id ? this.pending.get(msg.id) : null;
          if (waiter) { this.pending.delete(msg.id); waiter(msg); }
        }
      });
      proc.stderr.on('data', chunk => this.logger.debug?.(`[TimesFM] ${chunk.toString().trim()}`));
      proc.once('error', err => finish(false, err));
      proc.once('exit', (code, signal) => {
        this.proc = null;
        if (!settled) finish(false, new Error(`TimesFM worker exited (${code ?? 'null'}/${signal || 'unknown'})`));
        const pending = this.pending.splice(0);
        pending.forEach(resolve => resolve({ available: false, error: 'worker-exited' }));
      });
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async forecast({ symbol, direction, prices, horizon = 8 }) {
    if (!this.enabled || !Array.isArray(prices) || prices.length < 32) return { enabled: this.enabled, available: false, error: 'insufficient-input' };
    await this.start();
    if (!this.proc) return { enabled: true, available: false, error: 'worker-unavailable' };
    const id = `${process.pid}-${Date.now()}-${++this.requestSeq}`;
    const payload = JSON.stringify({ id, symbol, direction, prices: prices.slice(-16384), horizon: Math.min(64, Math.max(1, Number(horizon) || 8)) });
    this.stats.requests++;
    const started = Date.now();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stats.timeouts++;
        resolve({ id, enabled: true, available: false, error: 'timeout' });
      }, this.timeoutMs);
      const done = msg => {
        clearTimeout(timer);
        this.stats.lastLatencyMs = Date.now() - started;
        if (msg?.available) { this.stats.successful++; this.stats.lastSuccessAt = Date.now(); }
        else this.stats.errors++;
        resolve(msg);
      };
      this.pending.set(id, done);
      try { this.proc.stdin.write(payload + '\n'); }
      catch (err) { clearTimeout(timer); this.pending.delete(id); this.stats.errors++; resolve({ id, enabled: true, available: false, error: err.message }); }
    });
  }

  getStatus() {
    return { enabled: this.enabled, ready: !!(this.proc && !this.proc.killed), model: this.model, pending: this.pending.size, ...this.stats };
  }

  async stop() {
    if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM');
    this.proc = null;
    for (const [id, waiter] of this.pending.entries()) { this.pending.delete(id); waiter({ id, available: false, error: 'stopped' }); }
  }
}

module.exports = { TimesFMForecastAgent };
