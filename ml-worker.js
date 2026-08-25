'use strict';
const { parentPort, workerData } = require('worker_threads');
const { TensorFlowSignalModel } = require('./ml-engine');
const model = new TensorFlowSignalModel({ modelDir: workerData.modelDir, minSamples: workerData.minSamples || 40 });
let ready = false;
async function init(){ ready = await model.load(); parentPort.postMessage({ type:'ready', loaded:ready, stats:model.getStats() }); }
parentPort.on('message', async msg => {
  try {
    if (msg.type === 'predict') parentPort.postMessage({ id:msg.id, result:model.predict(msg.features) });
    else if (msg.type === 'stats') parentPort.postMessage({ id:msg.id, result:model.getStats() });
    else if (msg.type === 'shutdown') process.exit(0);
  } catch (e) { parentPort.postMessage({ id:msg.id, error:e.message }); }
});
init().catch(e => parentPort.postMessage({ type:'ready', loaded:false, error:e.message }));
