'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * JARVIS Event Bus
 * Central, read-only observability backbone for scan -> agents -> risk ->
 * decision -> execution -> outcome -> RL feedback.
 * The bus never submits orders and never changes trading state.
 */
class JarvisEventBus extends EventEmitter {
  constructor({ maxEvents = 1000, auditTrail = null, logger = null, replayDir = null } = {}) {
    super();
    this.maxEvents = Math.max(100, Number(maxEvents) || 1000);
    this.events = [];
    this.auditTrail = auditTrail;
    this.logger = logger;
    this.replayDir = replayDir ? path.resolve(replayDir) : null;
    if (this.replayDir) fs.mkdirSync(this.replayDir, { recursive: true });
    this.lastPersisted = new Map();
  }

  emitEvent(type, payload = {}, options = {}) {
    const event = {
      eventId: crypto.randomUUID(),
      type: String(type),
      ts: Date.now(),
      source: options.source || 'jarvis',
      severity: options.severity || 'INFO',
      symbol: payload.symbol || null,
      payload: this.#safe(payload)
    };
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) this.events.length = this.maxEvents;
    this.emit('event', event);

    if (options.persistReplay && this.replayDir) {
      try {
        const day = new Date(event.ts).toISOString().slice(0, 10);
        const file = path.join(this.replayDir, `${day}.jsonl`);
        fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
      } catch (err) {
        this.logger?.warn?.(`[JARVIS EventBus] replay append failed: ${err.message}`);
      }
    }

    if (options.persist && this.auditTrail?.append) {
      const key = `${event.type}:${event.symbol || ''}`;
      const minInterval = Number(options.persistMinIntervalMs ?? 1000);
      const last = this.lastPersisted.get(key) || 0;
      if (event.ts - last >= minInterval) {
        try {
          this.auditTrail.append({
            event: 'JARVIS_EVENT',
            eventId: event.eventId,
            eventType: event.type,
            severity: event.severity,
            source: event.source,
            symbol: event.symbol,
            payload: event.payload
          });
          this.lastPersisted.set(key, event.ts);
        } catch (err) {
          this.logger?.warn?.(`[JARVIS EventBus] audit append failed: ${err.message}`);
        }
      }
    }
    return event;
  }

  recent({ limit = 100, since = 0, symbol = null, types = null } = {}) {
    const allowed = Array.isArray(types) && types.length ? new Set(types.map(String)) : null;
    return this.events
      .filter(e => (!since || e.ts > Number(since)) && (!symbol || e.symbol === symbol) && (!allowed || allowed.has(e.type)))
      .slice(0, Math.min(500, Math.max(1, Number(limit) || 100)));
  }

  snapshot() {
    return { size: this.events.length, newest: this.events[0]?.ts || null, oldest: this.events.at(-1)?.ts || null };
  }

  #safe(value) {
    try {
      return JSON.parse(JSON.stringify(value, (_, v) => {
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'function') return undefined;
        return v;
      }));
    } catch (_) {
      return { value: String(value) };
    }
  }
}

module.exports = { JarvisEventBus };
