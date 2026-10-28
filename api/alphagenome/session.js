import {sameOrigin,readBody,reply,sessionCookie} from '../../server/alphaGenomeCloud.js';
export default async function handler(req,res){
 if(req.method!=='POST'||!sameOrigin(req))return reply(res,403,{error:'Same-origin POST required'});
 try{const {code}=await readBody(req,2048);const cookie=sessionCookie(code);if(!cookie)return reply(res,401,{error:'The analysis access code was not accepted.'});res.setHeader('Set-Cookie',cookie);reply(res,200,{authenticated:true});}
 catch{reply(res,400,{error:'Invalid access request'});}
}
