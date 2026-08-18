'use strict';
class AuditLogger {
  constructor({ collection = null, logger = console } = {}) { this.collection = collection; this.logger = logger; }
  async write(event, data = {}) {
    const record = { event, timestamp: new Date(), ...data };
    this.logger.info(`[AUDIT] ${event} ${JSON.stringify(data)}`);
    if (this.collection) {
      try { await this.collection.insertOne(record); } catch (e) { this.logger.error(`[AUDIT DB ERROR] ${e.message}`); }
    }
    return record;
  }
}
module.exports = { AuditLogger };
