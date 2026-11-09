import {createConfigReadTransport} from './transport.mjs';
import {ConfigError} from './errors.mjs';
import {validateConfigQuery} from './config-request-schema.mjs';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
function send(res,status,data){res.writeHead(status,headers);res.end(JSON.stringify(data));}
export function createConfigHttpReadHandler(config){
 const read=createConfigReadTransport(config);
 return async(req,res)=>{
  let url;try{url=new URL(req.url??'/', 'http://localhost')}catch{return false;}
  if(url.pathname!=='/v1/config/evaluate')return false;
  if(req.method!=='GET'){send(res,405,{error:'method_not_allowed'});return true;}
  const names=[...url.searchParams.keys()];
  if(req.headers?.cookie||req.headers?.['x-company-id']||req.headers?.['x-forwarded-user']||names.length!==3||new Set(names).size!==3||
     ['key','application','environment'].some(k=>url.searchParams.getAll(k).length!==1)){
   send(res,400,{error:'invalid_parameters'});return true;
  }
  try{
   const query=validateConfigQuery(Object.fromEntries(url.searchParams));
   const result=await read({authorization:req.headers?.authorization,...query});
   send(res,200,result);
  }catch(e){
   send(res,e instanceof ConfigError?403:503,{error:e instanceof ConfigError?'request_denied':'config_unavailable'});
  }
  return true;
 };
}
