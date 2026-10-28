import {authenticated,reply,jobPath,jobStatus,readPrivate} from '../../server/alphaGenomeCloud.js';
export default async function handler(req,res){
 if(!authenticated(req))return reply(res,401,{error:'Unlock online analysis first.'});
 if(req.method!=='GET')return reply(res,405,{error:'GET required'});
 try{const id=new URL(req.url,'https://assured.invalid').searchParams.get('id'),status=await jobStatus(id);if(!status)return reply(res,404,{error:'Analysis not found'});
  if(status.status==='complete')return reply(res,200,{...status,report:await readPrivate(`${jobPath(id)}/report.json`)});
  reply(res,200,status);
 }catch(error){console.error('alphagenome_status_failed',error.name);reply(res,503,{error:'Analysis status is temporarily unavailable.'});}
}
