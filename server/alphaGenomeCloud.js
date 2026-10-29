import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { get, put } from '@vercel/blob';

export const COOKIE = '__Host-assured-review';
export const MAX_BODY = 2_400_000;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export function reviewSecret(env = process.env) {
  if (env.ASSURED_REVIEW_SECRET?.length >= 32) return env.ASSURED_REVIEW_SECRET;
  const apiKey = String(env.ALPHAGENOME_API_KEY || '').trim();
  const accessHash = String(env.ASSURED_REVIEW_ACCESS_HASH || '').trim();
  return apiKey && accessHash ? hash(`assured-review-secret:v1:${apiKey}:${accessHash}`) : '';
}
export const mac = (value, env = process.env) => createHmac('sha256', reviewSecret(env)).update(value).digest('hex');
export function equal(a, b) { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && timingSafeEqual(x,y); }
export const configured = (env=process.env) => Boolean(env.ALPHAGENOME_API_KEY && reviewSecret(env).length >= 32 && env.ASSURED_REVIEW_ACCESS_HASH && (env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID));
/** Names of required server env vars that are absent or too short. Values are never returned. */
export function missingReviewerConfig(env=process.env) {
  const missing = [];
  if (!env.ALPHAGENOME_API_KEY) missing.push('ALPHAGENOME_API_KEY');
  if (!env.ASSURED_REVIEW_ACCESS_HASH) missing.push('ASSURED_REVIEW_ACCESS_HASH');
  if (!(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID)) missing.push('BLOB_READ_WRITE_TOKEN|BLOB_STORE_ID');
  return missing;
}
export function authenticated(req, env=process.env, now=Date.now()) {
  if (!configured(env)) return false;
  const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  const [expiry,signature]=String(cookie||'').split('.');
  return /^\d+$/.test(expiry) && Number(expiry)>now && Number(expiry)<=now+8*86400000 && equal(signature,mac(`session:${expiry}`,env));
}
/** Public status for the Design-and-review panel. Auth is required only when the cloud reviewer is actually configured. */
export function reviewerStatus(req, env=process.env, now=Date.now()) {
  const ready = configured(env);
  const status = {
    available: ready,
    mode: ready ? 'cloud' : 'unconfigured',
    authenticated: ready && authenticated(req, env, now),
    authenticationRequired: ready,
  };
  // When unconfigured, name which Production env vars are missing (never their values).
  if (!ready) status.missing = missingReviewerConfig(env);
  return status;
}
/** Only hashes the deployment owner configured are accepted; a comma-separated list allows rotating a code without locking the current one out. */
function matchesAccessHash(code, env=process.env) {
  const allowed = String(env.ASSURED_REVIEW_ACCESS_HASH || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  // A code pasted from a password manager often carries a trailing space or newline.
  const candidates = [...new Set([String(code || ''), String(code || '').trim()].filter(Boolean))];
  return candidates.some(c => allowed.some(h => equal(hash(c), h)));
}
export function sessionCookie(code, env=process.env, now=Date.now()) {
  if (!configured(env) || !matchesAccessHash(code, env)) return null;
  const expiry=now+7*86400000;
  return `${COOKIE}=${expiry}.${mac(`session:${expiry}`,env)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800`;
}
export function sameOrigin(req) {
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'');
  return req.headers.origin===`https://${host}` || (process.env.NODE_ENV==='test' && req.headers.origin===`http://${host}`);
}
export async function readBody(req, max=MAX_BODY) {
  if (Number(req.headers['content-length']||0)>max) throw new Error('Payload too large');
  if(req.body!==undefined){const body=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(Buffer.byteLength(body)>max)throw new Error('Payload too large');return JSON.parse(body);}
  let body='';
  for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>max)throw new Error('Payload too large');}
  return JSON.parse(body);
}
export function reply(res,status,data) {res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.status(status).json(data);}
export function validateEnvelope(batch) {
  if (batch?.schema!=='assured-alphagenome-comparison-request/1' || !/^[a-f0-9]{64}$/.test(batch.sourceId||''))throw new Error('Invalid comparison');
  const {requestId,...payload}=batch;
  if(requestId!==hash(canonical(payload)))throw new Error('Request identity mismatch');
  if(!Array.isArray(batch.candidates)||batch.candidates.length<1||batch.candidates.length>12||new Set(batch.candidates.map(c=>c.id)).size!==batch.candidates.length)throw new Error('Choose 1–12 unique donors');
  for(const c of batch.candidates) {
    if(c.request?.schema==='assured-alphagenome-allele-request/1' && (batch.candidates.length!==1 || c.id!=='edited-allele'))throw new Error('Review one defined allele at a time');
    if(typeof c.id!=='string'||c.id.length>80)throw new Error('Invalid donor identity');
    const {requestId,...r}=c.request||{};
    if(requestId!==hash(canonical(r)) || !['assured-alphagenome-request/1','assured-alphagenome-allele-request/1'].includes(r.schema) || r.assembly!=='GRCh38' || ![16384,131072,524288,1048576].includes(r.sequenceLength) || !/^[ACGTN]{1,1000000}$/.test(r.reference?.sequence||''))throw new Error('Invalid donor request');
  }
}
export async function readPrivate(path) {
  const data=await get(path,{access:'private',useCache:false});
  return data?.statusCode===200 ? JSON.parse(await new Response(data.stream).text()) : null;
}
export async function writePrivate(path,data) {await put(path,JSON.stringify(data),{access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:true,cacheControlMaxAge:60});}
export const jobPath=id=>`alphagenome/v1/jobs/${id}`;
export function validJobId(id){return /^[a-f0-9]{64}$/.test(String(id||''));}
export async function jobStatus(id, read=readPrivate) {
  if(!validJobId(id))return null;
  return read(`${jobPath(id)}/status.json`);
}

/** An explicit retry creates one new queue delivery group after a terminal failure.
 * Completed evidence is reused. Concurrent retries of the same failed state share
 * a key, so a browser retry cannot fan out duplicate model jobs.
 */
export async function prepareJob(batch, {read=jobStatus,write=writePrivate,sign=mac,now=()=>new Date().toISOString()}={}) {
  const id=sign(`job:${batch.requestId}`),path=jobPath(id);
  let status=await read(id);
  if(!status || status.status==='failed') {
    const queueKey=status ? sign(`retry:${id}:${status.updatedAt}`) : id;
    await write(`${path}/request.json`,batch);
    status={id,status:'queued',completed:0,total:batch.candidates.length,requestId:batch.requestId,queueKey,updatedAt:now()};
    await write(`${path}/status.json`,status);
  }
  return {id,status};
}

/** Queue delivery is at least once. Completed reports are reused and never recomputed. */
export async function processJob({id}, metadata, {read=readPrivate,write=writePrivate,fetchFn=fetch,env=process.env}={}) {
  if(!validJobId(id))throw new Error('Invalid queued job identity');
  const path=jobPath(id),status=await read(`${path}/status.json`);
  if(status?.status==='complete'||status?.status==='failed')return;
  const batch=await read(`${path}/request.json`);
  if(!batch)throw new Error('Missing queued request');
  validateEnvelope(batch);
  const update=fields=>write(`${path}/status.json`,{id,total:batch.candidates.length,requestId:batch.requestId,...fields,updatedAt:new Date().toISOString()});
  await update({status:'running',completed:0});
  try {
    // The deployment URL comes from Vercel, never from a user-provided URL.
    if(!/^[a-z0-9.-]+\.vercel\.app$/.test(env.VERCEL_URL||''))throw new Error('Missing deployment URL');
    const body=JSON.stringify(batch),timestamp=String(Date.now());
    const response=await fetchFn(`https://${env.VERCEL_URL}/api/alphagenome/worker`,{method:'POST',headers:{'Content-Type':'application/json','X-Assured-Timestamp':timestamp,'X-Assured-Signature':mac(`${timestamp}:${body}`,env)},body,signal:AbortSignal.timeout(240000)});
    if(!response.ok)throw new Error('Prediction worker unavailable');
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',bytes=0,report=null;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.length;if(bytes>6_000_000)throw new Error('Prediction output too large');
      pending+=decoder.decode(value,{stream:true});
      let split;
      while((split=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,split);pending=pending.slice(split+1);if(!line.trim())continue;
        const event=JSON.parse(line);
        if(event.type==='progress')await update({status:'running',completed:Math.min(batch.candidates.length,Math.max(0,event.completed||0))});
        if(event.type==='error')throw new Error('Prediction worker failed');
        if(event.type==='result')report=event.report;
      }
    }
    if(!report||report.requestId!==batch.requestId||report.candidates?.length!==batch.candidates.length)throw new Error('Incomplete prediction output');
    await write(`${path}/report.json`,report);
    await update({status:'complete',completed:batch.candidates.length});
  } catch(error) {
    // Do not persist provider errors: their text can contain credential metadata.
    if(metadata.deliveryCount>=2)await update({status:'failed',error:'Online prediction did not complete after two attempts. The previous design was retained.'});
    else await update({status:'queued',completed:0});
    throw new Error('AlphaGenome job failed');
  }
}
