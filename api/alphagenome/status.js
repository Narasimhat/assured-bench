import {authenticated,configured,reply} from '../../server/alphaGenomeCloud.js';
export default function handler(req,res){if(req.method!=='GET')return reply(res,405,{error:'GET required'});reply(res,200,{available:configured(),mode:'cloud',authenticated:authenticated(req),authenticationRequired:true});}
