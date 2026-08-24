'use strict';
class PortfolioRiskAgent {
  constructor({ maxExposureRatio = 0.6, maxCorrelation = 0.85 } = {}) { this.maxExposureRatio=maxExposureRatio; this.maxCorrelation=maxCorrelation; }
  evaluate({ exposureRatio=0, correlationRisk=0, sameDirection=0, maxSameDirection=2 }={}) {
    const exposure=Number(exposureRatio), corr=Number(correlationRisk);
    const veto=exposure>=this.maxExposureRatio || corr>=this.maxCorrelation || Number(sameDirection)>=Number(maxSameDirection);
    return { approved:!veto, score:Math.max(0,1-Math.max(exposure/Math.max(this.maxExposureRatio,0.01),corr)), veto, reasons:[...(exposure>=this.maxExposureRatio?['max-exposure']:[]),...(corr>=this.maxCorrelation?['correlation-cap']:[]),...(Number(sameDirection)>=Number(maxSameDirection)?['same-direction-cap']:[])] };
  }
}
module.exports={PortfolioRiskAgent};
