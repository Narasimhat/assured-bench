import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {authenticated,sessionCookie,hash,canonical,mac,validateEnvelope,processJob,readBody,reviewerStatus} from '../server/alphaGenomeCloud.js';
import {reviewRequestId} from '../src/services/alphaGenomeReview.js';
import {readDonorReviewResponse} from '../src/services/alphaGenomeOnline.js';
const env={ASSURED_REVIEW_SECRET:'x'.repeat(48),ASSURED_REVIEW_ACCESS_HASH:hash('private-access-code'),ALPHAGENOME_API_KEY:'test-only',BLOB_READ_WRITE_TOKEN:'test-only',VERCEL_URL:'assured-test.vercel.app'};
const batch=async()=>{
 const request={schema:'assured-alphagenome-request/1',assembly:'GRCh38',reference:{start:1,sequence:'ACGT'},requestedOutputs:['RNA_SEQ','SPLICE_SITES','SPLICE_SITE_USAGE'],sequenceLength:16384};
 const payload={schema:'assured-alphagenome-comparison-request/1',sourceId:'a'.repeat(64),annotation:{},candidates:[{id:'pair-1',request:{...request,requestId:await reviewRequestId(request)}}]};
 return {...payload,requestId:await reviewRequestId(payload)};
};
test('cloud access uses signed, expiring HttpOnly cookies, fails closed and never accepts the provider key',()=>{
 const now=100000, cookie=sessionCookie('private-access-code',env,now);
 assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);assert.equal(sessionCookie('test-only',env,now),null);
 const req={headers:{cookie:cookie.split(';')[0]}};
 assert.equal(authenticated(req,env,now),true);assert.equal(authenticated(req,env,now+8*86400000),false);
 assert.equal(authenticated({headers:{cookie:req.headers.cookie+'tampered'}},env,now),false);
 assert.equal(authenticated(req,{...env,BLOB_READ_WRITE_TOKEN:''},now),false);
});
test('status asks for an access code only when the cloud reviewer is configured',()=>{
 const empty=reviewerStatus({headers:{}},{});
 assert.deepEqual(empty,{available:false,mode:'unconfigured',authenticated:false,authenticationRequired:false,missing:['ALPHAGENOME_API_KEY','ASSURED_REVIEW_ACCESS_HASH','BLOB_READ_WRITE_TOKEN|BLOB_STORE_ID']});
 const partial=reviewerStatus({headers:{}},{ALPHAGENOME_API_KEY:'k',ASSURED_REVIEW_SECRET:'x'.repeat(48)});
 assert.deepEqual(partial.missing,['ASSURED_REVIEW_ACCESS_HASH','BLOB_READ_WRITE_TOKEN|BLOB_STORE_ID']);
 const derivedEnv={ALPHAGENOME_API_KEY:'test-only',ASSURED_REVIEW_ACCESS_HASH:hash('private-access-code'),BLOB_READ_WRITE_TOKEN:'test-only',VERCEL_URL:'assured-test.vercel.app'};
 assert.deepEqual(reviewerStatus({headers:{}},derivedEnv),{available:true,mode:'cloud',authenticated:false,authenticationRequired:true});
 const locked=reviewerStatus({headers:{}},env);
 assert.deepEqual(locked,{available:true,mode:'cloud',authenticated:false,authenticationRequired:true});
 assert.equal(locked.missing,undefined);
 const now=100000, cookie=sessionCookie('private-access-code',env,now);
 const unlocked=reviewerStatus({headers:{cookie:cookie.split(';')[0]}},env,now);
 assert.deepEqual(unlocked,{available:true,mode:'cloud',authenticated:true,authenticationRequired:true});
 const derivedCookie=sessionCookie('private-access-code',derivedEnv,now);
 assert.deepEqual(reviewerStatus({headers:{cookie:derivedCookie.split(';')[0]}},derivedEnv,now),{available:true,mode:'cloud',authenticated:true,authenticationRequired:true});
});
test('cloud envelope hashes exactly match browser and Python canonical identities',async()=>{
 const b=await batch();assert.doesNotThrow(()=>validateEnvelope(b));assert.equal(hash(canonical({z:1,requestedOutputs:[],requestId:'x'})),await reviewRequestId({z:1,requestedOutputs:[],requestId:'x'}));
 assert.throws(()=>validateEnvelope({...b,sourceId:'b'.repeat(64)}),/identity/);
 const bad=structuredClone(b);bad.candidates[0].request.reference.sequence='AAAA';assert.throws(()=>validateEnvelope(bad));
});
test('queued processing persists progress and matching evidence, reuses completed work, and signs only the fixed deployment worker',async()=>{
 const b=await batch(),id=mac('test',env),data=new Map([[`alphagenome/v1/jobs/${id}/request.json`,b]]),writes=[];
 const report={requestId:b.requestId,candidates:[{id:'pair-1',status:'complete'}]};let calls=0;
 const deps={env,read:async p=>data.get(p)||null,write:async(p,d)=>{data.set(p,d);writes.push(d)},fetchFn:async(url,init)=>{
  calls++;assert.equal(url,'https://assured-test.vercel.app/api/alphagenome/worker');assert.ok(init.headers['X-Assured-Signature']);assert.equal(init.body,JSON.stringify(b));
  return new Response(JSON.stringify({type:'progress',completed:1})+'\n'+JSON.stringify({type:'result',report})+'\n');
 }};
 await processJob({id},{deliveryCount:1},deps);assert.ok(writes.some(x=>x.status==='running'&&x.completed===1));assert.equal(data.get(`alphagenome/v1/jobs/${id}/status.json`).status,'complete');
 await processJob({id},{deliveryCount:2},deps);assert.equal(calls,1);
});
test('worker failures remain failures without exposing provider error text or accepting incomplete output',async()=>{
 const b=await batch(),id=mac('failure',env),writes=[];
 await assert.rejects(()=>processJob({id},{deliveryCount:2},{env,read:async p=>p.endsWith('request.json')?b:null,write:async(p,d)=>writes.push(d),fetchFn:async()=>{throw new Error('secret-provider-diagnostic')}}),/job failed/);
 assert.equal(writes.at(-1).status,'failed');assert.doesNotMatch(JSON.stringify(writes),/secret-provider-diagnostic/);
});
test('online polling returns only a completed report and handles failure, cancellation and malformed job identities',async()=>{
 const id='b'.repeat(64),response=()=>new Response(JSON.stringify({jobId:id}),{status:202});let calls=0;
 const result=await readDonorReviewResponse(response(),{pollMs:0,fetchFn:async()=>new Response(JSON.stringify(++calls===1?{status:'running',completed:1,total:2}:{status:'complete',report:{requestId:'done'}}))});assert.equal(result.requestId,'done');
 await assert.rejects(()=>readDonorReviewResponse(response(),{fetchFn:async()=>new Response(JSON.stringify({status:'failed',error:'Prediction failed'}))}),/Prediction failed/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>readDonorReviewResponse(response(),{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(()=>readDonorReviewResponse(new Response(JSON.stringify({jobId:'../other'}),{status:202})),/identity/);
});
test('cloud requests enforce payload limits before parsing',async()=>{
 const req=Readable.from(['123456']);req.headers={};await assert.rejects(()=>readBody(req,3),/too large/);
});
