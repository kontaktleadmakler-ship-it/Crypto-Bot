'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const runtime = fs.readFileSync(path.join(__dirname, '..', 'trading-bot-v25-marketdata-fixed.mjs'), 'utf8');
const env = fs.readFileSync(path.join(__dirname, '..', 'env.example'), 'utf8');

assert.match(runtime, /function createInstanceLockIdentity\(\)/);
assert.match(runtime, /crypto\.randomUUID\(\)/);
assert.match(runtime, /lockToken/);
assert.match(runtime, /instanceId: null/);
assert.match(runtime, /lastSeen: \{ \$lt: staleBefore \}/);
assert.match(runtime, /instanceId, lockToken/);
assert.match(runtime, /OWNERSHIP LOST/);
assert.match(runtime, /executionCoreReady = false;/);
assert.match(runtime, /isPaused = true;/);
assert.match(runtime, /lockHeartbeatInFlight/);
assert.match(runtime, /LOCK_STALE_AFTER_MS: parseInt\(process\.env\.LOCK_STALE_AFTER_MS, 10\) \|\| 30 \* 1000/);
assert.match(env, /LOCK_STALE_AFTER_MS=30000/);
assert.match(env, /LOCK_HEARTBEAT_INTERVAL_MS=5000/);

console.log('PASS instance-lock-hardening source checks');
