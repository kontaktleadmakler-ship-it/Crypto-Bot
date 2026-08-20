'use strict';
const fs = require('fs/promises');
function kpis(trades=[]) { const pnls=trades.map(t=>Number(t.pnlUSD||0)).filter(Number.isFinite);const wins=pnls.filter(x=>x>0),losses=pnls.filter(x=>x<0);const grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));const avg=pnls.length?pnls.reduce((a,b)=>a+b,0)/pnls.length:0;const sd=pnls.length?Math.sqrt(pnls.reduce((a,b)=>a+(b-avg)**2,0)/pnls.length):0;return {trades:pnls.length,netPnL:pnls.reduce((a,b)=>a+b,0),winRate:pnls.length?wins.length/pnls.length*100:0,profitFactor:grossLoss?grossWin/grossLoss:Infinity,sharpe:sd?avg/sd*Math.sqrt(pnls.length):0}; }
async function writeJsonReport(file, data){await fs.writeFile(file,JSON.stringify(data,null,2));return file;}
module.exports={kpis,writeJsonReport};
