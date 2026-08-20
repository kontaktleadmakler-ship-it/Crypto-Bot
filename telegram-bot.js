'use strict';
const axios=require('axios');
const {BoundedAsyncQueue}=require('./queue');

/**
 * Telegram controller.
 * // FIX: bounded queue; oldest pending message is discarded after max size.
 */
class TelegramBotController {
  constructor({token='',chatId='',maxQueue=100,ratePerMinute=20,logger=console}={}) {
    this.token=token; this.chatIds=String(chatId).split(',').map(x=>x.trim()).filter(Boolean);
    this.logger=logger; this.ratePerMinute=ratePerMinute; this.sent=[];
    this.queue=new BoundedAsyncQueue({maxSize:maxQueue,logger,worker:job=>this._send(job)});
    this.offset=0; this.polling=false;
  }
  async _rateLimit(){
    const now=Date.now(); this.sent=this.sent.filter(t=>now-t<60000);
    if(this.sent.length>=this.ratePerMinute) await new Promise(r=>setTimeout(r,60000-(now-this.sent[0])+25));
    this.sent.push(Date.now());
  }
  enqueue(chatId,text){this.queue.push({chatId,text});}
  async _send({chatId,text}){
    if(!this.token) return;
    await this._rateLimit();
    await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`,
      {chat_id:chatId,text,parse_mode:'HTML'},{timeout:10000});
  }
  async send(text){for(const id of this.chatIds)this.enqueue(id,text);}
  async health(){
    if(!this.token)return {ok:false,reason:'missing-token'};
    try {const r=await axios.get(`https://api.telegram.org/bot${this.token}/getMe`,{timeout:5000});return {ok:r.data?.ok===true};}
    catch(e){return {ok:false,reason:e.message};}
  }
  async poll(handleUpdate,{timeout=25}={}){
    if(this.polling)return; this.polling=true;
    try{
      while(this.polling){
        const r=await axios.get(`https://api.telegram.org/bot${this.token}/getUpdates`,{params:{offset:this.offset,timeout},timeout:(timeout+5)*1000});
        for(const update of r.data?.result||[]){this.offset=update.update_id+1;await handleUpdate(update);}
      }
    }finally{this.polling=false;}
  }
  stop(){this.polling=false;}
}
module.exports={TelegramBotController};
