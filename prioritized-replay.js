'use strict';
class PrioritizedReplayBuffer {
  constructor({capacity=10000, alpha=0.6, beta=0.4}={}) { this.capacity=capacity; this.alpha=alpha; this.beta=beta; this.items=[]; this.priorities=[]; this.position=0; }
  get size(){ return this.items.length; }
  add(item, priority=1){ const p=Math.max(1e-6, Number(priority)||1); if(this.items.length<this.capacity){this.items.push(item);this.priorities.push(p);} else {this.items[this.position]=item;this.priorities[this.position]=p;this.position=(this.position+1)%this.capacity;} }
  sample(n){ const count=Math.min(n,this.items.length); const weightsRaw=this.priorities.map(p=>Math.pow(p,this.alpha)); const sum=weightsRaw.reduce((a,b)=>a+b,0)||1; const probs=weightsRaw.map(p=>p/sum); const indices=[]; const items=[]; for(let k=0;k<count;k++){let r=Math.random(),acc=0,idx=probs.length-1;for(let i=0;i<probs.length;i++){acc+=probs[i];if(r<=acc){idx=i;break;}} indices.push(idx);items.push(this.items[idx]);} const weights=indices.map(i=>Math.pow(this.items.length*probs[i],-this.beta)); const max=Math.max(...weights,1); return {items,indices,weights:weights.map(w=>w/max)}; }
  updatePriorities(indices,errors){ indices.forEach((i,k)=>{if(i>=0&&i<this.priorities.length)this.priorities[i]=Math.max(1e-6,Math.abs(Number(errors[k])||0)+1e-6);}); }
}
module.exports={PrioritizedReplayBuffer};
