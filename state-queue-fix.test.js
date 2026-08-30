import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CriticalStateQueue } from '../execution-core/critical-state-queue.mjs';

const runtime = fs.readFileSync(new URL('../trading-bot-v24.6-runtime.mjs', import.meta.url), 'utf8');

assert.match(runtime, /CriticalStateQueue/);
assert.match(runtime, /persistCriticalState/);
assert.match(runtime, /protectedSubmit/);
assert.match(runtime, /global\.reconciliationHealthy = false/);

// DB loss must reject critical state writes instead of silently keeping them in RAM.
const queue = new CriticalStateQueue({ isHealthy: () => false });
await assert.rejects(queue.enqueue(async () => undefined), /CRITICAL_STATE_DB_UNHEALTHY/);

console.log('state_queue_fix: PASS');
