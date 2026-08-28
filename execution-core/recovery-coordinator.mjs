'use strict';

export class RecoveryCoordinator {
  constructor({ executionRepository, reconciliationEngine, logger = console } = {}) {
    this.executionRepository = executionRepository;
    this.reconciliationEngine = reconciliationEngine;
    this.logger = logger;
  }

  async recover() {
    const unknown = await this.executionRepository.findByStates?.([
      'ORDER_SUBMITTING',
      'UNKNOWN',
      'RECONCILING'
    ]) || [];

    const results = [];
    for (const execution of unknown) {
      try {
        results.push(await this.reconciliationEngine.reconcileExecution(execution));
      } catch (err) {
        this.logger.error?.(`[RECOVERY] ${execution.executionId}: ${err.message}`);
        results.push({
          executionId: execution.executionId,
          status: 'REQUIRES_MANUAL_REVIEW',
          error: err.message
        });
      }
    }
    return results;
  }
}

export default RecoveryCoordinator;
