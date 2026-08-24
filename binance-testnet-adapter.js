'use strict';
const crypto=require('crypto');
class BinanceTestnetAdapter{constructor({enabled=false,mode='SIMULATED',logger=console}={}){this.enabled=Boolean(enabled);this.mode=mode;this.logger=logger;this.orders=new Map();this.positions=new Map();this.connected=false}
 async connect(){this.connected=true;return {connected:true,mode:this.mode,liveExecution:false}}
 async placeOrder(order){if(!this.enabled)throw new Error('TESTNET_DISABLED');if(this.mode!=='SIMULATED')throw new Error('LIVE_EXECUTION_DISABLED');const id=order.clientOrderId||crypto.randomUUID();const o={...order,orderId:id,status:'FILLED',filledQty:Number(order.quantity||order.qty||0),avgPrice:Number(order.price||order.referencePrice||0),simulated:true,ts:Date.now()};this.orders.set(id,o);return o}
 async cancelOrder(id){const o=this.orders.get(id);if(!o)return null;o.status='CANCELED';return o}
 snapshot(){return {connected:this.connected,enabled:this.enabled,mode:this.mode,liveExecution:false,orders:[...this.orders.values()],positions:[...this.positions.values()]}}
}
module.exports={BinanceTestnetAdapter};
