/** Wait for a durable cloud job. Local reviews still return a report directly. */
export async function readDonorReviewResponse(response,{fetchFn=fetch,signal,onProgress=()=>{},pollMs=2000}={}) {
 let data;try{data=await response.json()}catch{throw new Error('The AlphaGenome reviewer is unavailable. Start the local app or use the configured online reviewer.')}
 if(!response.ok)throw new Error(data.error||'AlphaGenome review did not complete.');
 if(response.status!==202)return data;
 if(!/^[a-f0-9]{64}$/.test(data.jobId||''))throw new Error('The online reviewer returned an invalid job identity.');
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){
  if(signal?.aborted)throw new DOMException('Stopped waiting for online analysis','AbortError');
  const status=await fetchFn(`/api/alphagenome/jobs?id=${data.jobId}`,{signal,credentials:'same-origin',cache:'no-store'});
  const job=await status.json();
  if(!status.ok)throw new Error(job.error||'The online analysis could not be retrieved.');
  if(job.status==='complete'){if(!job.report)throw new Error('The completed prediction report is missing.');return job.report;}
  if(job.status==='failed')throw new Error(job.error||'Online prediction failed.');
  onProgress(job.status==='queued'?'Online analysis queued. You can return and run the same review to retrieve its result.':`Online AlphaGenome review running: ${job.completed||0}/${job.total||'?'} designs completed. Waiting for the prediction report…`);
  await new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new DOMException('Stopped waiting','AbortError'))};const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},pollMs);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();});
 }
 throw new Error('The online review is still pending. Run the same review again to retrieve it without submitting duplicate work.');
}
