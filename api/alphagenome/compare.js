import {send} from '@vercel/queue';
import {authenticated,configured,sameOrigin,readBody,reply,validateEnvelope,prepareJob} from '../../server/alphaGenomeCloud.js';
export default async function handler(req,res){
 if(!configured())return reply(res,503,{error:'The online reviewer is not configured.'});
 if(!authenticated(req))return reply(res,401,{error:'Unlock online analysis with your access code.'});
 if(req.method!=='POST'||!sameOrigin(req))return reply(res,403,{error:'Same-origin POST required'});
 try{
  const batch=await readBody(req);validateEnvelope(batch);const {id,status}=await prepareJob(batch);
  // Retries after a terminal failure use a new persisted group; queued browser
  // retries reuse it. Completed evidence is never recomputed.
  if(status.status==='queued')await send('assured-alphagenome',{id},{idempotencyKey:status.queueKey||id,retentionSeconds:3600});
  reply(res,202,{jobId:id,status:status.status});
 }catch(error){console.error('alphagenome_submit_failed',error.name);reply(res,400,{error:'The online comparison could not be queued. Check the request and retry.'});}
}
