// B16 Production Readiness Gate
module.exports={canPromote:(state)=>state.replayParity&&state.riskHealthy&&state.shadowHealthy};