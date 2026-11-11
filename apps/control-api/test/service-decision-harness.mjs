import {createServer} from 'node:http';
import {once} from 'node:events';
import {createSkilledDecisionHandler,SKILLED_DECISION_PATH} from '../src/service-decision-handler.mjs';
export const issuer='https://id.example.test';
export const org='00000000-0000-4000-8000-000000000001';
export const token='central-service-'+'a'.repeat(40);
export const subject='logto-user-0001';
export const requestId='b'.repeat(43);
export const valid={applicationId:'academy',issuer,subject,organisationId:org,requestId};
export const decision={allowed:true,applicationId:'academy',organisationId:'logto-org-0001',
 localUserId:'skilled-user-0001',localAccountId:'skilled-account-0001',
 membershipRevision:1,entitlementRevision:2,linkRevision:3};
export async function call({body=valid,auth='Bearer '+token,method='POST',url=SKILLED_DECISION_PATH,
 decide=async()=>decision,headers={},logger=()=>{},clock}={}){
 const handler=createSkilledDecisionHandler({issuer,audience:'academy-client',token,decide,logger,...(clock?{clock}:{})});
 const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.statusCode=404;res.end('not found')}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+url,{
   method,headers:{authorization:auth,'content-type':'application/json',...headers},
   ...(method!=='GET'&&method!=='HEAD'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})
  });
  let output;try{output=await response.json()}catch{output=null}
  return {status:response.status,body:output,headers:response.headers};
 }finally{server.closeAllConnections();server.close();await once(server,'close')}
}
