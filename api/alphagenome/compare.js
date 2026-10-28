import {send} from '@vercel/queue';
import {authenticated,configured,sameOrigin,readBody,reply,validateEnvelope,mac,jobPath,jobStatus,writePrivate} from '../../server/alphaGenomeCloud.js';
export default async function handler(req,res){
 if(!configured())return reply(res,503,{error:'The online reviewer is not configured.'});
 if(!authenticated(req))return reply(res,401,{error:'Unlock online analysis with your access code.'});
 if(req.method!=='POST'||!sameOrigin(req))return reply(res,403,{error:'Same-origin POST required'});
 try{
  const batch=await readBody(req);validateEnvelope(batch);const id=mac(`job:${batch.requestId}`),path=jobPath(id);
  let status=await jobStatus(id);
  if(!status){await writePrivate(`${path}/request.json`,batch);status={id,status:'queued',completed:0,total:batch.candidates.length,requestId:batch.requestId,updatedAt:new Date().toISOString()};await writePrivate(`${path}/status.json`,status);}
  // Stable key deduplicates concurrent submissions and makes a browser retry resumable.
  if(status.status==='queued')await send('assured-alphagenome',{id},{idempotencyKey:id,retentionSeconds:3600});
  reply(res,202,{jobId:id,status:status.status});
 }catch(error){console.error('alphagenome_submit_failed',error.name);reply(res,400,{error:'The online comparison could not be queued. Check the request and retry.'});}
}
