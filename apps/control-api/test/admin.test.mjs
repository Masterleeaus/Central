import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createCentralHandler} from '../src/app.mjs';
import {createAdminHandler} from '../src/admin.mjs';
const ORIGINS={field:'https://field.titanzero.io',desk:'https://desk.titanzero.io',academy:'https://academy.titanzero.io'};
const AUDIENCES={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const ID='00000000-0000-4000-8000-000000000001';
const command={kind:'membership',id:ID,organisationId:ID,identityId:ID,role:'learner'};
const input={requestId:ID,authorityReference:'logto-audit:123',command};
async function invoke(path,{method='GET',auth=true,allow=true,authorize=async()=>allow,verify=async()=>({logtoSubject:'member1'}),provision=async()=> 'created',body=undefined,origins=ORIGINS}={}){
 const calls=[];const handler=createAdminHandler({verifyToken:verify,authoriseOperator:authorize,provision:provision===null?undefined:async(...args)=>{calls.push(args);return provision(...args)},origins});
 const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 const s=createServer(createCentralHandler({pool,verifyToken:verify,issuer:'https://issuer.test',audiences:AUDIENCES,adminHandler:handler}));s.listen(0,'127.0.0.1');await once(s,'listening');
 try {const opts={method,headers:auth?{authorization:'Bearer abc.def.ghi'}:{}};
 if(body!==undefined){opts.headers['content-type']='application/json';opts.body=typeof body==='string'?body:JSON.stringify(body);}
 const res=await fetch(`http://127.0.0.1:${s.address().port}${path}`,opts);return {status:res.status,body:await res.json(),calls};}
 finally{s.close();await once(s,'close');}
}
test('unauthenticated admin access fails closed',async()=>assert.equal((await invoke('/v1/admin/oidc/plans',{auth:false})).status,401));
test('invalid JWT fails closed',async()=>assert.equal((await invoke('/v1/admin/oidc/plans',{verify:async()=>{throw Error('bad token')}})).status,401));
test('missing live operator authority denies access',async()=>assert.equal((await invoke('/v1/admin/oidc/plans',{allow:false})).status,403));
test('unavailable authority returns 503',async()=>assert.equal((await invoke('/v1/admin/oidc/plans',{authorize:async()=>{throw Error('offline')}})).status,503));
test('OIDC plans use fixed origins, code and PKCE, no client secrets',async()=>{const r=await invoke('/v1/admin/oidc/plans');assert.equal(r.status,200);assert.equal(r.body.applications.length,3);assert.equal(r.body.applications[0].pkce,'S256');assert.equal(r.body.applications.find(a=>a.app==='field').redirectUris[0],'https://field.titanzero.io/auth/titan/field/callback');assert.ok(!JSON.stringify(r.body).includes('secret'));});
test('query cannot modify OIDC plans',async()=>assert.equal((await invoke('/v1/admin/oidc/plans?origin=https://evil.example')).status,400));
test('admin endpoints reject wrong HTTP method',async()=>assert.equal((await invoke('/v1/admin/provision')).status,405));
test('provision disabled by default',async()=>assert.equal((await invoke('/v1/admin/provision',{method:'POST',provision:null,body:input})).status,503));
test('approved provisioning uses token subject not caller-supplied subject',async()=>{const r=await invoke('/v1/admin/provision',{method:'POST',body:input});assert.equal(r.status,201);assert.equal(r.calls[0][0].logtoSubject,'member1');assert.equal(r.calls[0][1].actorSubject,'member1');});
test('idempotent replay is 200',async()=>assert.equal((await invoke('/v1/admin/provision',{method:'POST',body:input,provision:async()=> 'replayed'})).status,200));
test('identity/organisation creation forbidden on organisation admin API',async()=>{const r=await invoke('/v1/admin/provision',{method:'POST',body:{...input,command:{kind:'identity',id:ID,logtoSubject:'new'}}});assert.equal(r.status,400);assert.equal(r.calls.length,0);});
test('caller injected actor is rejected',async()=>assert.equal((await invoke('/v1/admin/provision',{method:'POST',body:{...input,actorSubject:'owner'}})).status,400));
test('excess or unsupported command fields rejected',async()=>assert.equal((await invoke('/v1/admin/provision',{method:'POST',body:{...input,command:{...command,owner:'other'}}})).status,400));
test('malformed command rejected',async()=>assert.equal((await invoke('/v1/admin/provision',{method:'POST',body:{...input,command:{...command,organisationId:'bad'}}})).status,400));
test('invalid provisioning caller role rejected',async()=>assert.equal((await invoke('/v1/admin/provision',{method:'POST',body:{...input,command:{...command,role:'superuser'}}})).status,400));
test('service failures do not leak details',async()=>{const r=await invoke('/v1/admin/provision',{method:'POST',body:input,provision:async()=>{throw Error('sensitive database details')}});assert.equal(r.status,503);assert.ok(!JSON.stringify(r.body).includes('sensitive'));});
test('default Central handler has no admin interface',async()=>{const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}})};const s=createServer(createCentralHandler({pool,verifyToken:async()=>({logtoSubject:'a'}),issuer:'https://issuer.test',audiences:AUDIENCES}));s.listen(0,'127.0.0.1');await once(s,'listening');try{const r=await fetch(`http://127.0.0.1:${s.address().port}/v1/admin/oidc/plans`);assert.equal(r.status,404)}finally{s.close();await once(s,'close')}});

// Account-link commands (issue #37): the assertion replaces caller-supplied verification times.
const JWS='eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c3JfYWJjZGVmMTIifQ.c2lnbmF0dXJl';
const linkBody=(command)=>({requestId:ID,authorityReference:'logto-audit:123',command});
test('link command requires a signed assertion, not a caller-supplied verifiedAt',async()=>{
 const ok=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link',id:ID,identityId:ID,organisationId:ID,applicationId:'field',localUserId:'u-1',localAccountId:'a-1',assertion:JWS})});
 assert.equal(ok.status,201);
 const old=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link',id:ID,identityId:ID,organisationId:ID,applicationId:'field',localUserId:'u-1',localAccountId:'a-1',verifiedAt:'2026-11-02T00:00:00.000Z'})});
 assert.equal(old.status,400);
 const notJws=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link',id:ID,identityId:ID,organisationId:ID,applicationId:'field',localUserId:'u-1',localAccountId:'a-1',assertion:'not-a-token'})});
 assert.equal(notJws.status,400);
});
test('relink and unlink are accepted only with an expected revision',async()=>{
 const relink=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link_relink',id:ID,identityId:ID,organisationId:ID,applicationId:'desk',expectedRevision:2,localUserId:'u-2',localAccountId:'a-2',assertion:JWS})});
 assert.equal(relink.status,201);
 const relinkNoRev=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link_relink',id:ID,identityId:ID,organisationId:ID,applicationId:'desk',localUserId:'u-2',localAccountId:'a-2',assertion:JWS})});
 assert.equal(relinkNoRev.status,400);
 const unlink=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link_revoke',id:ID,organisationId:ID,expectedRevision:3})});
 assert.equal(unlink.status,201);
 const unlinkNoRev=await invoke('/v1/admin/provision',{method:'POST',body:linkBody({kind:'link_revoke',id:ID,organisationId:ID})});
 assert.equal(unlinkNoRev.status,400);
});
