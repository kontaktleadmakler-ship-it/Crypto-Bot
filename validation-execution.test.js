const assert=require('assert');const {ValidationEngine}=require('./validation-engine');const {ExecutionEngine}=require('./execution-engine');
assert(new ValidationEngine().evaluate({profitFactor:1.7,sharpe:1.2,maxDrawdown:.08,oosPassRate:.8,robustnessScore:.8}).approved);
assert(!new ValidationEngine().evaluate({profitFactor:1,sharpe:.5,maxDrawdown:.2,oosPassRate:.3,robustnessScore:.3}).approved);
const e=new ExecutionEngine();const o=e.createOrder({clientOrderId:'test',symbol:'BTC-USDT',side:'buy',qty:1});assert.equal(o.status,'SIMULATED');console.log('Validation/Execution tests passed');
