'use strict';
class OOSValidator{validate({train=[],validation=[],test=[],evaluate,threshold=0}={}){if(typeof evaluate!=='function')throw new Error('EVALUATOR_REQUIRED');const trainScore=evaluate(train),validationScore=evaluate(validation),oosScore=evaluate(test);return {passed:Number(oosScore)>=Number(threshold),threshold,train:{score:trainScore},validation:{score:validationScore},outOfSample:{score:oosScore},degradation:{trainToOOS:Number(trainScore)-Number(oosScore),validationToOOS:Number(validationScore)-Number(oosScore)}}}}
module.exports={OOSValidator};
