import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * JARVIS Event Bus
 *
 * Central, read-only observability backbone:
 * scan -> agents -> risk -> decision -> execution -> outcome -> RL feedback.
 *
 * IMPORTANT:
 * - Never submits orders.
 * - Never changes trading state.
 * - Keeps a bounded in-memory event buffer.
 * - Optional replay/audit persistence is best-effort and never breaks the
 *   trading/runtime path.
 *
 * ESM-native version for the current package.json ("type": "module").
 */

export class JarvisEventBus extends EventEmitter {
  constructor({
    maxEvents = 1000,
    auditTrail = null,
    logger = null,
    replayDir = null
  } = {}) {
    super();

    this.maxEvents = Math.max(100, Number(maxEvents) || 1000);
    this.events = [];
    this.auditTrail = auditTrail;
    this.logger = logger;
    this.replayDir = replayDir ? path.resolve(String(replayDir)) : null;
    this.lastPersisted = new Map();

    if (this.replayDir) {
      try {
        fs.mkdirSync(this.replayDir, { recursive: true });
      } catch (err) {
        this.logger?.warn?.(
          `[JARVIS EventBus] replay directory init failed: ${err.message}`
        );
        this.replayDir = null;
      }
    }

    this.on('error', (err) => {
      this.logger?.warn?.(
        `[JARVIS EventBus] emitter error: ${err?.message || String(err)}`
      );
    });
  }

  emitEvent(type, payload = {}, options = {}) {
    const event = Object.freeze({
      eventId: crypto.randomUUID(),
      type: String(type ?? 'UNKNOWN'),
      ts: Date.now(),
      source: String(options.source || 'jarvis'),
      severity: String(options.severity || 'INFO'),
      symbol: payload?.symbol || null,
      payload: this.#safe(payload)
    });

    this.events.unshift(event);

    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }

    try {
      this.emit('event', event);
    } catch (err) {
      this.logger?.warn?.(
        `[JARVIS EventBus] event listener failed: ${err.message}`
      );
    }

    if (options.persistReplay && this.replayDir) {
      this.#persistReplay(event);
    }

    if (options.persist && this.auditTrail?.append) {
      this.#persistAudit(event, options);
    }

    return event;
  }

  #persistReplay(event) {
    try {
      const day = new Date(event.ts).toISOString().slice(0, 10);
      const file = path.join(this.replayDir, `${day}.jsonl`);
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (err) {
      this.logger?.warn?.(
        `[JARVIS EventBus] replay append failed: ${err.message}`
      );
    }
  }

  #persistAudit(event, options) {
    const key = `${event.type}:${event.symbol || ''}`;
    const minInterval = Math.max(
      0,
      Number(options.persistMinIntervalMs ?? 1000) || 0
    );
    const last = this.lastPersisted.get(key) || 0;

    if (event.ts - last < minInterval) return;

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
      this.logger?.warn?.(
        `[JARVIS EventBus] audit append failed: ${err.message}`
      );
    }
  }

  recent({
    limit = 100,
    since = 0,
    symbol = null,
    types = null
  } = {}) {
    const normalizedLimit = Math.min(
      500,
      Math.max(1, Number(limit) || 100)
    );

    const sinceTs = Number(since) || 0;

    const allowed =
      Array.isArray(types) && types.length
        ? new Set(types.map(String))
        : null;

    return this.events
      .filter(
        (event) =>
          (!sinceTs || event.ts > sinceTs) &&
          (!symbol || event.symbol === symbol) &&
          (!allowed || allowed.has(event.type))
      )
      .slice(0, normalizedLimit);
  }

  snapshot() {
    return {
      size: this.events.length,
      newest: this.events[0]?.ts || null,
      oldest: this.events.at(-1)?.ts || null
    };
  }

  clear() {
    this.events.length = 0;
    this.lastPersisted.clear();
  }

  #safe(value) {
    try {
      return JSON.parse(
        JSON.stringify(value, (_, v) => {
          if (typeof v === 'bigint') return Number(v);
          if (typeof v === 'function') return undefined;
          return v;
        })
      );
    } catch (_) {
      return { value: String(value) };
    }
  }
}

export default JarvisEventBus;
