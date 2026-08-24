'use strict';
const {PortfolioEngine}=require('./institutional-portfolio-engine');
const {ShadowAnalyzer}=require('./shadow-analyzer');
class InstitutionalPaperShadowSuite{constructor({symbols=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'],equity=100000}={}){this.symbols=[...symbols];this.portfolio=new PortfolioEngine({equity});this.analyzer=new ShadowAnalyzer();this.paperTrades=[];this.shadowTrades=[];this.correlation={}}
 addSymbol(s){if(!this.symbols.includes(s))this.symbols.push(s)}
 paperOpen(o){const p=this.portfolio.open(o);this.paperTrades.push({type:'OPEN',...p});return p}
 paperClose(symbol,price,reason){const c=this.portfolio.close(symbol,price,reason);if(c)this.paperTrades.push({type:'CLOSE',...c});return c}
 recordShadow(r){const x={...r,mode:'SHADOW',ts:Date.now()};this.shadowTrades.push(x);return x}
 setCorrelations(matrix){this.correlation=matrix||{}}
 snapshot(){return {symbols:this.symbols,portfolio:this.portfolio.snapshot(),paperTrades:this.paperTrades,shadowTrades:this.shadowTrades,correlations:this.correlation}}
}
module.exports={InstitutionalPaperShadowSuite};
