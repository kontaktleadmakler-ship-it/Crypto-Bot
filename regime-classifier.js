// B15 Market Regime Classifier
module.exports={classify:(vol)=>vol>0.03?'HIGH_VOL':'NORMAL'};