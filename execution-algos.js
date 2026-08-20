'use strict';
function splitQuantity(total, slices){const n=Math.max(1,Number(slices)||1), q=total/n, out=[];for(let i=0;i<n;i++)out.push(i===n-1?total-q*i:q);return out;}
function twapSchedule({quantity, slices=10, intervalMs=60000}){return splitQuantity(quantity,slices).map((size,i)=>({index:i,size,delayMs:i*intervalMs}));}
function vwapSchedule({quantity, volumeBuckets, participation=0.1}){const buckets=(volumeBuckets||[]).map(Number).filter(Number.isFinite);const total=buckets.reduce((a,b)=>a+b,0)||1;return buckets.map((v,i)=>({index:i,size:quantity*(v/total)*participation,volume:v}));}
function slippageBps(expected, executed, side){const e=Number(expected),x=Number(executed);if(!(e>0)||!(x>0))return 0;return ((side==='buy'?x-e:e-x)/e)*10000;}
module.exports={twapSchedule,vwapSchedule,slippageBps};
