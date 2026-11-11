import assert from 'node:assert/strict';
import {launchCiCentral,httpRequest,flagsPath,freePort} from './http-server-harness.mjs';
const pools=[];let live;
try{
 live=await launchCiCentral({onPool:p=>pools.push(p)});
 assert.equal(pools.length,3);
 const a=await httpRequest(live.baseUrl,flagsPath,{clientId:'svc_a'});
 const c=await httpRequest(live.baseUrl,flagsPath,{clientId:'svc_c'});
 assert.equal(a.status,200);assert.equal(a.body.value,true);
 assert.equal(c.status,200);assert.equal(c.body.value,false);
 for(const clientId of ['svc_revoked','svc_expired','svc_unknown'])
  assert.equal((await httpRequest(live.baseUrl,flagsPath,{clientId})).status,403,clientId);
 assert.equal((await httpRequest(live.baseUrl,flagsPath,{claims:{aud:'other-audience'}})).status,403);
 assert.equal((await httpRequest(live.baseUrl,flagsPath,{claims:{iss:'https://other.test/'}})).status,403);
 assert.equal((await httpRequest(live.baseUrl,flagsPath,{claims:{client_id:'svc_c',azp:'svc_a'}})).status,403);
 assert.equal((await httpRequest(live.baseUrl,flagsPath,{headers:{'x-company-id':'550e8400-e29b-41d4-a716-446655440003'}})).status,400);
 assert.equal((await httpRequest(live.baseUrl,flagsPath+'&company_id=550e8400-e29b-41d4-a716-446655440003')).status,400);
 assert.equal((await httpRequest(live.baseUrl,flagsPath+'&key=ci_flag')).status,400);
 assert.equal((await httpRequest(live.baseUrl,flagsPath,{auth:false})).status,403);
 assert.equal((await httpRequest(live.baseUrl,flagsPath,{method:'POST'})).status,405);
 const health=await httpRequest(live.baseUrl,'/healthz');
 assert.equal(health.status,200);assert.equal(health.body.status,'ok');
 assert.equal(live.jwksCount(),1);
 await Promise.all([live.service.close(),live.service.close()]);
 assert.ok(pools.every(p=>p._endCalls===1),'three SQL pools close once');
 await assert.rejects(fetch(live.baseUrl+'/healthz',{signal:AbortSignal.timeout(2000)}));
 live=null;
 const disabled=await launchCiCentral({configEnabled:false,port:await freePort()});
 try{assert.equal((await httpRequest(disabled.baseUrl,flagsPath)).status,404)}
 finally{await disabled.service.close()}
 console.log('Real HTTP socket JWT PostgreSQL tenants, denial and lifecycle passed');
}finally{if(live)await live.service.close()}
