'use strict';

import { ExecutionState } from './execution-state-machine.js';
import { assertPreTradeSafe } from '../pre-trade-gate.mjs';

/**
 * Single execution gateway.
 *
 * Runtime code must never call an exchange/paper submitter directly.
 * All submissions pass:
 * Signal -> Risk -> Pre-Trade Gate -> Fencing -> Idempotency ->
 * Execution Intent -> ORDER_SUBMITTING -> Submitter -> ACK/FILL/UNKNOWN.
 */
export async function protectedSubmit({
  symbol,
  side,
  clientOrderId,
  payload,
  riskContext,
  orderBookValid,
  spreadPct,
  marketDataAgeMs,
  reserveExecutionIntent,
  transitionExecution,
  submitter,
  logger = console,
  riskGovernor = null,
  riskGovernorAction = null,
  riskGovernorReducedSize = false
}) {
  if (typeof submitter !== 'function') throw new Error('ORDER_SUBMITTER_REQUIRED');
  if (typeof reserveExecutionIntent !== 'function') throw new Error('EXECUTION_RESERVATION_REQUIRED');
  if (typeof transitionExecution !== 'function') throw new Error('EXECUTION_TRANSITION_REQUIRED');

  if (riskGovernor && typeof riskGovernor.assertExecutionAllowed === 'function') {
    riskGovernor.assertExecutionAllowed({
      action: riskGovernorAction || payload?.action || 'OPEN',
      proposed: payload?.notionalUSD ? { notionalUSD: payload.notionalUSD } : undefined,
      reducedSize: riskGovernorReducedSize
    });
  }

  const ctx = {
    ...riskContext,
    orderBookValid: orderBookValid === true,
    spreadPct,
    marketDataAgeMs
  };

  // Fail closed BEFORE creating an execution intent. This is the actual
  // pre-trade gate, not a duplicate check hidden inside the submitter.
  assertPreTradeSafe(ctx);

  const reservation = await reserveExecutionIntent({
    symbol, side, clientOrderId, payload
  });

  await transitionExecution({
    executionId: reservation.executionId,
    sm: reservation.sm,
    next: ExecutionState.RISK_APPROVED,
    payload: { riskContext: ctx }
  });

  await transitionExecution({
    executionId: reservation.executionId,
    sm: reservation.sm,
    next: ExecutionState.IDEMPOTENCY_RESERVED
  });

  await transitionExecution({
    executionId: reservation.executionId,
    sm: reservation.sm,
    next: ExecutionState.ORDER_SUBMITTING
  });

  let remote;
  try {
    remote = await submitter({
      ...payload,
      symbol,
      side,
      clientOrderId
    });
  } catch (err) {
    const ambiguous = ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN']
      .includes(err?.code) ||
      /timeout|timed out|connection reset|network|socket/i.test(err?.message || '');

    if (ambiguous) {
      await transitionExecution({
        executionId: reservation.executionId,
        sm: reservation.sm,
        next: ExecutionState.UNKNOWN,
        payload: { error: err.message, code: err.code }
      });
      logger.error?.(`[EXECUTION] UNKNOWN ${reservation.executionId}; reconciliation required`);
      throw Object.assign(new Error('EXECUTION_UNKNOWN_RECONCILIATION_REQUIRED'), {
        cause: err,
        executionId: reservation.executionId
      });
    }

    await transitionExecution({
      executionId: reservation.executionId,
      sm: reservation.sm,
      next: ExecutionState.FAILED,
      payload: { error: err.message, code: err.code }
    });
    throw err;
  }

  const remoteStatus = String(remote?.status || '').toUpperCase();
  const next =
    remoteStatus === 'FILLED' ? ExecutionState.FILLED :
    remoteStatus === 'PARTIALLY_FILLED' ? ExecutionState.PARTIALLY_FILLED :
    ExecutionState.ACKNOWLEDGED;

  try {
    await transitionExecution({
      executionId: reservation.executionId,
      sm: reservation.sm,
      next,
      payload: { remote }
    });
  } catch (err) {
    // The remote submit already happened. A persistence failure here is
    // ambiguous from the runtime's perspective and MUST NOT be treated as a
    // clean failure, otherwise a retry could create a duplicate order.
    try {
      if (reservation.sm.canTransition(ExecutionState.UNKNOWN)) {
        await transitionExecution({
          executionId: reservation.executionId,
          sm: reservation.sm,
          next: ExecutionState.UNKNOWN,
          payload: {
            reason: 'POST_SUBMIT_STATE_PERSISTENCE_FAILURE',
            error: err.message
          }
        });
      }
    } catch (recoveryErr) {
      logger.error?.(
        `[EXECUTION] CRITICAL state persistence failure for ${reservation.executionId}: ${recoveryErr.message}`
      );
    }

    throw Object.assign(new Error('EXECUTION_POST_SUBMIT_STATE_UNKNOWN'), {
      cause: err,
      executionId: reservation.executionId
    });
  }

  return {
    executionId: reservation.executionId,
    state: next,
    remote
  };
}

export default protectedSubmit;
