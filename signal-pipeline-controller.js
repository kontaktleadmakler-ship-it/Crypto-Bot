'use strict';

/**
 * Non-blocking signal pipeline primitives.
 *
 * Design rule: agents -> risk -> execution is strictly one-way. A rejection
 * is terminal for that candidate and is never sent back to an upstream agent.
 */

const TERMINAL = new Set(['REJECTED', 'APPROVED', 'EXECUTED', 'ERROR']);

function now() { return Date.now(); }

function createPipeline(symbol, scanId) {
  return {
    signalId: null,
    symbol: String(symbol || '').toUpperCase(),
    scanId,
    stage: 'CANDIDATE',
    status: 'RUNNING',
    startedAt: now(),
    updatedAt: now(),
    attempts: 0,
    history: [{ stage: 'CANDIDATE', at: now() }],
    reason: null
  };
}

function transition(pipeline, stage, data = {}) {
  if (!pipeline) return pipeline;
  if (TERMINAL.has(pipeline.stage) && stage !== pipeline.stage) return pipeline;
  pipeline.stage = String(stage);
  pipeline.updatedAt = now();
  pipeline.history.push({ stage: pipeline.stage, at: pipeline.updatedAt, ...data });
  if (data.reason) pipeline.reason = String(data.reason);
  if (stage === 'REJECTED' || stage === 'ERROR') pipeline.status = 'TERMINAL';
  if (stage === 'APPROVED' || stage === 'EXECUTED') pipeline.status = 'COMPLETE';
  return pipeline;
}

function reject(pipeline, reason, details = {}) {
  return transition(pipeline, 'REJECTED', { reason, ...details });
}

function withTimeout(task, timeoutMs, label = 'PIPELINE_TIMEOUT') {
  const ms = Math.max(1, Number(timeoutMs) || 1);
  let timer;
  let settled = false;
  const work = Promise.resolve().then(task);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (!settled) {
        const err = new Error(`${label}:${ms}`);
        err.code = label;
        reject(err);
      }
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    settled = true;
    clearTimeout(timer);
  });
}

module.exports = { createPipeline, transition, reject, withTimeout };
