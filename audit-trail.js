/**
 * v22.7 B11 - Append-only audit trail.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AuditTrail {
  constructor({ file = process.env.AUDIT_TRAIL_FILE || './data/audit/audit.jsonl' } = {}) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  append(event) {
    if (!event || typeof event !== 'object') throw new Error('INVALID_AUDIT_EVENT');
    const row = {
      schemaVersion: 1,
      auditId: crypto.randomUUID(),
      ts: Date.now(),
      ...event
    };
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n', 'utf8');
    return row;
  }
}

module.exports = { AuditTrail };
