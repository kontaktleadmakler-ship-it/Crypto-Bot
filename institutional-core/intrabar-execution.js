'use strict';
/** Conservative OHLC execution policy: when stop and target are both touched by one bar, stop wins. */
function resolveIntrabar({direction,high,low,stopLoss,tp1,tp2,tp1Hit=false}={}){
  const d=String(direction).toUpperCase(); const h=Number(high),l=Number(low);
  if(!(Number.isFinite(h)&&Number.isFinite(l))) return {event:'NONE'};
  if(d==='LONG'){
    if(Number.isFinite(stopLoss)&&l<=stopLoss) return {event:'STOP',price:Number(stopLoss)};
    if(!tp1Hit&&Number.isFinite(tp1)&&h>=tp1) return {event:'TP1',price:Number(tp1)};
    if(Number.isFinite(tp2)&&h>=tp2) return {event:'TP2',price:Number(tp2)};
  } else if(d==='SHORT'){
    if(Number.isFinite(stopLoss)&&h>=stopLoss) return {event:'STOP',price:Number(stopLoss)};
    if(!tp1Hit&&Number.isFinite(tp1)&&l<=tp1) return {event:'TP1',price:Number(tp1)};
    if(Number.isFinite(tp2)&&l<=tp2) return {event:'TP2',price:Number(tp2)};
  }
  return {event:'NONE'};
}
module.exports={resolveIntrabar};
