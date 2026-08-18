'use strict';
require('dotenv').config();
const express=require('express');
const {buildConfig,validateConfig}=require('./config');
const {KucoinApi}=require('./api/kucoin');
const {TelegramBotController}=require('./telegram-bot');
const {RiskManager}=require('./risk-manager');
const {PaperTradeTracker}=require('./tracker');

/**
 * // IMPROVED: composition root for the refactored services.
 * The legacy signal scanner remains the compatibility entrypoint until all
 * stateful scan/tracker callbacks have been dependency-injected.
 *
 * // SAFETY: this composition root only initializes paper/signal services.
 */
function createApp(overrides={}) {
  const config=validateConfig({...buildConfig(process.env),...overrides.config});
  const logger=overrides.logger||console;
  const kucoin=overrides.kucoin||new KucoinApi({logger});
  const telegram=overrides.telegram||new TelegramBotController({token:config.TELEGRAM_BOT_TOKEN,chatId:config.TELEGRAM_CHAT_ID,maxQueue:config.TELEGRAM_QUEUE_MAX,logger});
  const risk=new RiskManager(config,logger);
  const tracker=new PaperTradeTracker({logger,fundingIntervalHours:config.FUNDING_INTERVAL_HOURS});
  const app=express(); app.use(express.json());
  app.use((req,res,next)=>{
    if(req.path==='/health' && process.env.HEALTH_PUBLIC==='true') return next();
    if(!config.API_KEY) return res.status(503).json({error:'API key not configured'});
    if(req.get('X-API-Key')!==config.API_KEY)return res.status(401).json({error:'unauthorized'});
    next();
  });
  app.get('/health',async(req,res)=>{
    const [kucoinStatus,telegramStatus]=await Promise.all([kucoin.health().then(ok=>({ok})).catch(e=>({ok:false,reason:e.message})),telegram.health()]);
    const status=kucoinStatus.ok&&telegramStatus.ok?'ok':'degraded';
    res.status(status==='ok'?200:503).json({status,dependencies:{kucoin:kucoinStatus,telegram:telegramStatus},ml:{trained:false}});
  });
  return {app,config,kucoin,telegram,risk,tracker};
}
if(require.main===module){
  const {app,config}=createApp();
  app.listen(config.PORT,config.API_BIND_HOST,()=>console.log(`API listening on ${config.API_BIND_HOST}:${config.PORT}`));
}
module.exports={createApp};
