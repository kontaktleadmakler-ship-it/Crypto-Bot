'use strict';
class PrioritizedReplayBuffer {
  constructor({ capacity=10000, alpha=0.6, beta=0.4, betaIncrement=0.001, epsilon=1e-5 }={}) { this.capacity=capacity;this.alpha=alpha;this.beta=beta;this.betaIncrement=betaIncrement;this.epsilon=epsilon;this.items=[];this.priorities=[]; }
  add(item, priority=1){const p=Math.pow(Math.abs(Number(priority))+this.epsilon,this.alpha);if(this.items.length>=this.capacity){this.items.shift();this.priorities.shift();}this.items.push(item);this.priorities.push(p);}
  sample(batchSize){if(!this.items.length)return {items:[],indices:[],weights:[]};const total=this.priorities.reduce((a,b)=>a+b,0)||1;const items=[],indices=[],weights=[];for(let n=0;n<Math.min(batchSize,this.items.length);n++){const r=Math.random()*total;let acc=0,idx=0;for(;idx<this.priorities.length;idx++){acc+=this.priorities[idx];if(acc>=r)break;}idx=Math.min(idx,this.items.length-1);indices.push(idx);items.push(this.items[idx]);const prob=this.priorities[idx]/total;weights.push(Math.pow(this.items.length*prob,-this.beta));}const max=Math.max(...weights,1);this.beta=Math.min(1,this.beta+this.betaIncrement);return {items,indices,weights:weights.map(w=>w/max)};}
  updatePriorities(indices, errors){indices.forEach((idx,i)=>{if(this.priorities[idx]!=null)this.priorities[idx]=Math.pow(Math.abs(Number(errors[i]||0))+this.epsilon,this.alpha);});}
  get size(){return this.items.length;}
}
module.exports = { PrioritizedReplayBuffer };
