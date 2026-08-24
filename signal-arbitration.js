'use strict';
class SignalArbitrator {
  constructor({ minScore = 0.58, logger = console } = {}) { this.minScore = minScore; this.logger = logger; }
  decide({ agentDecision, dqnAction = null, riskApproved = true, dataQuality = 1, llmDecision = null }) {
    const score = Number(agentDecision?.score ?? 0);
    const hardVeto = !!agentDecision?.veto || !riskApproved || dataQuality < 0.5 || dqnAction === 0;
    const llmReject = llmDecision && llmDecision.approved === false;
    const approved = !hardVeto && !llmReject && score >= this.minScore;
    return { approved, score, hardVeto, llmReject, reasons: [...(agentDecision?.reasons || []), ...(hardVeto ? ['hard-veto'] : []), ...(llmReject ? ['llm-review-rejected'] : [])] };
  }
}
module.exports = { SignalArbitrator };
