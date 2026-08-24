'use strict';
const {InstitutionalBacktestEngine}=require('./institutional-backtest-engine');
const {MonteCarloEngine}=require('./monte-carlo-engine');
const {WalkForwardEngine}=require('./walk-forward-engine');
const {OOSValidator}=require('./oos-validator');
const {MLEvaluationFramework}=require('./ml-evaluation-framework');
const {InstitutionalPaperShadowSuite}=require('./institutional-paper-shadow-suite');
const {BinanceTestnetAdapter}=require('./binance-testnet-adapter');
const {MetricsRegistry,HealthMonitor,AlertEngine,Dashboard}=require('./observability-suite');
const {ReportGenerator}=require('./institutional-reporting');
const {InstitutionalAgentSuite}=require('./agent-suite');
class InstitutionalPlatform{constructor(opts={}){this.backtest=new InstitutionalBacktestEngine(opts.backtest);this.monteCarlo=new MonteCarloEngine(opts.monteCarlo);this.walkForward=new WalkForwardEngine(opts.walkForward);this.oos=new OOSValidator();this.ml=new MLEvaluationFramework();this.paperShadow=new InstitutionalPaperShadowSuite(opts.paperShadow);this.testnet=new BinanceTestnetAdapter({enabled:opts.testnetEnabled===true,mode:'SIMULATED'});this.metrics=new MetricsRegistry();this.health=new HealthMonitor({metrics:this.metrics});this.alerts=new AlertEngine(opts.alerts);this.dashboard=new Dashboard({health:this.health,metrics:this.metrics,alerts:this.alerts});this.reports=new ReportGenerator(opts.reporting);this.agents=new InstitutionalAgentSuite(opts.agents)}
 evaluateBacktest(args){const result=this.backtest.run(args);this.metrics.inc('backtests');this.metrics.set('equity',result.finalEquity);return result}
 evaluateRisk(result){const mc=this.monteCarlo.run(result.trades,{initialEquity:result.initialEquity});return {backtest:result,monteCarlo:mc}}
 status(){return {version:'24.7.0-agent-suite',agents:['risk-supervisor','portfolio-allocation','anomaly-detection','liquidity','exit-evaluation','strategy-evaluation','meta-supervisor'],mode:'SIGNAL_PAPER_SHADOW',liveOrderExecution:false,health:this.dashboard.snapshot(),paperShadow:this.paperShadow.snapshot(),testnet:this.testnet.snapshot()}}
}
module.exports={InstitutionalPlatform};
