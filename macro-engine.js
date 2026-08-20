'use strict';

const axios = require('axios');

/**
 * FRED macro-release calendar for the trading bot.
 *
 * Important: FRED's release calendar exposes release DATES, not a guaranteed
 * intraday publication timestamp. We therefore use configurable default
 * publication times for the major US releases. These defaults can be
 * overridden per event via FRED_<KEY>_TIME in the environment.
 *
 * The engine is deliberately fail-safe: a failed refresh never clears the
 * last successful calendar. Manual NEWS_BLACKOUT_TIMES remain supported.
 */
class MacroEngine {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.apiKey = options.apiKey || process.env.FRED_API_KEY || '';
    this.refreshIntervalMs = Number(options.refreshIntervalMs) || 6 * 60 * 60 * 1000;
    this.beforeMs = Number(options.beforeMs) || 30 * 60 * 1000;
    this.afterMs = Number(options.afterMs) || 60 * 60 * 1000;
    this.events = [];
    this.lastSuccessfulRefresh = 0;
    this.lastAttempt = 0;
    this.warnedMissingKey = false;
    this.refreshInFlight = null;

    this.manualEvents = this.parseManualEvents(process.env.NEWS_BLACKOUT_TIMES);
    this.events = [...this.manualEvents];
  }

  parseManualEvents(raw) {
    if (!raw) return [];
    return raw.split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(value => {
        const time = Date.parse(value);
        return Number.isFinite(time) ? {
          id: `manual:${value}`,
          name: 'Manual Macro Blackout',
          impact: 'HIGH',
          time,
          source: 'env'
        } : null;
      })
      .filter(Boolean);
  }

  shouldRefresh(now = Date.now()) {
    return !this.lastSuccessfulRefresh || (now - this.lastSuccessfulRefresh >= this.refreshIntervalMs);
  }

  async refresh(force = false) {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (!force && !this.shouldRefresh()) return this.events;

    if (!this.apiKey) {
      if (!this.warnedMissingKey) {
        this.warnedMissingKey = true;
        this.logger.warn('[Macro] FRED_API_KEY fehlt – automatischer Makro-Kalender deaktiviert. Manuelle NEWS_BLACKOUT_TIMES bleiben aktiv.');
      }
      return this.events;
    }

    this.lastAttempt = Date.now();
    this.refreshInFlight = this._refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  async _refresh() {
    const now = new Date();
    const start = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 45 * 86400000).toISOString().slice(0, 10);

    const url = 'https://api.stlouisfed.org/fred/releases/dates';
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        params: {
          api_key: this.apiKey,
          file_type: 'json',
          realtime_start: start,
          realtime_end: end,
          limit: 1000,
          offset: 0,
          order_by: 'release_date',
          sort_order: 'asc',
          include_release_dates_with_no_data: 'true'
        },
        headers: { 'User-Agent': 'TradingBot/21.7 MacroEngine' }
      });

      const rows = Array.isArray(response.data?.release_dates)
        ? response.data.release_dates
        : [];

      const imported = rows
        .map(row => this.mapRelease(row))
        .filter(Boolean)
        .filter(event => event.time >= Date.now() - 2 * 86400000);

      const manual = this.manualEvents.filter(event => event.time >= Date.now() - 2 * 86400000);
      const dedup = new Map();
      for (const event of [...manual, ...imported]) {
        dedup.set(`${event.name}|${event.time}`, event);
      }

      const nextEvents = [...dedup.values()].sort((a, b) => a.time - b.time);
      // Fail-safe: a successful empty response must not erase manual events.
      if (nextEvents.length || rows.length === 0) {
        this.events = nextEvents;
      }

      this.lastSuccessfulRefresh = Date.now();
      this.warnedMissingKey = false;
      this.logger.info(`[Macro] FRED-Kalender aktualisiert: ${imported.length} relevante Events, ${this.events.length} gesamt.`);
      return this.events;
    } catch (e) {
      const status = e.response?.status;
      if (status === 429) {
        this.logger.warn('[Macro] FRED Rate-Limit (429). Letzter erfolgreicher Kalender bleibt aktiv.');
      } else {
        this.logger.warn(`[Macro] FRED-Import fehlgeschlagen${status ? ` (${status})` : ''}: ${e.message}. Letzter erfolgreicher Kalender bleibt aktiv.`);
      }
      return this.events;
    }
  }

  mapRelease(row) {
    const name = String(row.release_name || '').trim();
    const date = String(row.date || '').trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

    const classification = this.classify(name);
    if (!classification) return null;

    const time = this.releaseTimeMs(date, classification.key);
    if (!Number.isFinite(time)) return null;

    return {
      id: `fred:${row.release_id || name}:${date}`,
      releaseId: row.release_id ? Number(row.release_id) : null,
      name,
      key: classification.key,
      impact: classification.impact,
      time,
      date,
      source: 'FRED'
    };
  }

  classify(name) {
    const n = name.toLowerCase();

    const high = [
      ['Federal Open Market Committee', 'FOMC'],
      ['Consumer Price Index', 'CPI'],
      ['Personal Income and Outlays', 'PCE'],
      ['Gross Domestic Product', 'GDP'],
      ['Employment Situation', 'NFP'],
      ['Producer Price Index', 'PPI'],
      ['Retail Sales', 'RETAIL_SALES'],
      ['Industrial Production and Capacity Utilization', 'INDUSTRIAL_PRODUCTION'],
      ['Institute for Supply Management', 'ISM'],
      ['Purchasing Managers', 'PMI']
    ];

    for (const [needle, key] of high) {
      if (n.includes(needle.toLowerCase())) return { key, impact: 'HIGH' };
    }

    const medium = [
      ['Initial Claims', 'JOBLESS_CLAIMS'],
      ['Job Openings and Labor Turnover', 'JOLTS'],
      ['Consumer Confidence', 'CONSUMER_CONFIDENCE'],
      ['Durable Goods', 'DURABLE_GOODS'],
      ['New Residential Sales', 'NEW_HOME_SALES'],
      ['Existing Home Sales', 'EXISTING_HOME_SALES']
    ];

    for (const [needle, key] of medium) {
      if (n.includes(needle.toLowerCase())) return { key, impact: 'MEDIUM' };
    }

    return null;
  }

  releaseTimeMs(date, key) {
    // FRED release dates are date-only. Defaults are intentionally explicit and
    // configurable rather than pretending FRED supplies an exact timestamp.
    const defaults = {
      FOMC: '14:00',
      CPI: '08:30',
      PCE: '08:30',
      GDP: '08:30',
      NFP: '08:30',
      PPI: '08:30',
      RETAIL_SALES: '08:30',
      INDUSTRIAL_PRODUCTION: '09:15',
      ISM: '10:00',
      PMI: '09:45',
      JOBLESS_CLAIMS: '08:30',
      JOLTS: '10:00',
      CONSUMER_CONFIDENCE: '10:00',
      DURABLE_GOODS: '08:30',
      NEW_HOME_SALES: '10:00',
      EXISTING_HOME_SALES: '10:00'
    };

    const envKey = `FRED_${key}_TIME`;
    const localTime = process.env[envKey] || defaults[key] || process.env.FRED_DEFAULT_RELEASE_TIME || '08:30';
    const match = /^(\d{2}):(\d{2})$/.exec(localTime);
    if (!match) return NaN;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return NaN;

    // Major US releases are expressed in America/New_York local time.
    const [y, m, d] = date.split('-').map(Number);
    const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).formatToParts(utcNoon);
    const get = type => Number(parts.find(p => p.type === type)?.value);
    let localMinutesAtUtcNoon = get('hour') * 60 + get('minute');
    // If local hour is represented as 24:00, normalize it.
    if (localMinutesAtUtcNoon >= 1440) localMinutesAtUtcNoon -= 1440;
    const offsetMinutes = localMinutesAtUtcNoon - 720;

    return Date.UTC(y, m - 1, d, hour, minute) - offsetMinutes * 60000;
  }

  getActiveEvents(now = Date.now()) {
    return this.events.filter(event =>
      now >= event.time - this.beforeMs && now <= event.time + this.afterMs
    );
  }

  isBlackout(now = Date.now()) {
    return this.getActiveEvents(now).some(event => event.impact === 'HIGH');
  }

  getStatus(now = Date.now()) {
    const active = this.getActiveEvents(now);
    return {
      safe: !active.some(event => event.impact === 'HIGH'),
      active,
      next: this.events.find(event => event.time >= now) || null,
      lastSuccessfulRefresh: this.lastSuccessfulRefresh
    };
  }
}

module.exports = { MacroEngine };
