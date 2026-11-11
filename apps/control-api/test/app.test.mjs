import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';import net from 'node:net';
import {createCentralHandler} from '../src/app.mjs';
import {createJsonLogger} from '../src/structured-log.mjs';
const ORG='00000000-0000-4000-8000-000000000001';
const AUDIENCES={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const principal={logtoSubject:'user1',issuer:'https://issuer.example',audience:'aud-desk',verifiedAt:new Date().toISOString()};
const ACCESS=`/v1/access/check?organisation_id=${ORG}&application=desk&action=session:open`;
const allowRows=(sql)=>{
 if(sql.startsWith('SELECT id, logto_subject')) return {rows:[{id:'id-1',logto_subject:'user1',state:'active'}]};
 if(sql.startsWith('SELECT id, logto_organisation_id')) return {rows:[{id:ORG,logto_organisation_id:'org-ext',state:'active'}]};
 if(sql.startsWith('SELECT id, identity_id, organisation_id, role')) return {rows:[{id:'m-1',identity_id:'id-1',organisation_id:ORG,role:'member',state:'active',expires_at:null,revision:3}]};
 if(sql.startsWith('SELECT id, organisation_id, application_id')) return {rows:[{id:'e-1',organisation_id:ORG,application_id:'desk',state:'active',features:['session:open'],expires_at:null,revision:4}]};
 if(sql.startsWith('SELECT id, identity_id, organisation_id, application_id')) return {rows:[{id:'l-1',identity_id:'id-1',organisation_id:ORG,application_id:'desk',local_user_id:'lu-1',local_account_id:'la-1',state:'verified',verified_at:'2026-01-01T00:00:00.000Z',revision:5}]};
 return {rows:[]};
};
function makeHandler({verify=async()=>principal,query=async()=>({rows:[]}),healthQuery=async()=>({rows:[]}),calls=[],...rest}={}) {
 const pool={async connect(){return {async query(sql,args){calls.push([sql,args]);return query(sql,args)},release(){calls.push(['RELEASE'])}}}};
 return createCentralHandler({pool,verifyToken:verify,issuer:'https://issuer.example',audiences:AUDIENCES,healthQuery,...rest});
}
async function withServer(handler,fn){const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');try{return await fn(`http://127.0.0.1:${server.address().port}`,server.address().port)}finally{server.closeAllConnections();server.close();await once(server,'close')}}
async function run(path,{auth=true,...opts}={}) {const calls=[];return withServer(makeHandler({...opts,calls}),async base=>{const r=await fetch(base+path,{headers:auth?{authorization:'Bearer abc.def.ghi'}:{}});return {status:r.status,body:await r.json(),calls}})}
/** Raw HTTP request so malformed request lines reach the handler unchanged. */
function rawRequest(port,text){return new Promise((resolve,reject)=>{const c=net.connect(port,'127.0.0.1',()=>c.write(text));let d='';c.setTimeout(3000,()=>c.destroy(new Error('timeout')));c.on('data',x=>d+=x);c.on('error',reject);c.on('close',()=>resolve(d));});}

test('health reports ok when the database query succeeds',async()=>{const seen=[];const r=await run('/healthz',{auth:false,healthQuery:async(sql)=>{seen.push(sql);return {rows:[]}}});assert.equal(r.status,200);assert.deepEqual(r.body,{status:'ok'});assert.deepEqual(seen,['SELECT 1']);});
test('health returns 503 when the database query fails',async()=>{const r=await run('/healthz',{auth:false,healthQuery:async()=>{throw Error('connection refused at 10.0.0.5')}});assert.equal(r.status,503);assert.deepEqual(r.body,{status:'unavailable'});});
test('rejects requests without bearer',async()=>assert.equal((await run('/v1/access/check',{auth:false})).status,401));
test('rejects invalid bearer',async()=>assert.equal((await run('/v1/access/check',{verify:async()=>{throw Error('invalid')}})).status,401));
test('rejects caller-supplied identity',async()=>assert.equal((await run(`${ACCESS}&user_id=someone`)).status,400));
test('rejects duplicated tenant params',async()=>assert.equal((await run(`/v1/access/check?organisation_id=${ORG}&organisation_id=${ORG}&application=desk&action=read:jobs`)).status,400));
test('rejects invalid organisation',async()=>assert.equal((await run('/v1/access/check?organisation_id=none&application=desk&action=read:jobs')).status,400));
test('denies unknown identity, releases client',async()=>{const r=await run(`/v1/access/check?organisation_id=${ORG}&application=desk&action=read:jobs`);assert.equal(r.status,403);assert.equal(r.calls.at(-1)[0],'RELEASE');assert.ok(r.calls.some(x=>x[0]==='COMMIT'))});
test('query failure returns 503 and rolls back',async()=>{const r=await run(`/v1/access/check?organisation_id=${ORG}&application=desk&action=read:jobs`,{query:async(sql)=>{if(sql.startsWith('SELECT'))throw Error('db offline');return {rows:[]}}});assert.equal(r.status,503);assert.ok(r.calls.some(x=>x[0]==='ROLLBACK'));});
test('access check runs as the trusted reader scoped to the requested organisation',async()=>{const r=await run(ACCESS,{query:async sql=>allowRows(sql)});const scope=r.calls.find(x=>String(x[0]).startsWith('SELECT set_config'));assert.deepEqual(scope[1],[ORG]);assert.equal(scope[0].includes(ORG),false);assert.ok(r.calls.some(x=>x[0]==='SET LOCAL ROLE titan_trusted_reader'));});
test('allowed response has exactly allowed, role and reason',async()=>{const r=await run(ACCESS,{query:async sql=>allowRows(sql)});assert.equal(r.status,200);assert.deepEqual(r.body,{allowed:true,role:'member',reason:'allowed'});});
test('denied response has exactly allowed, role and reason',async()=>{const r=await run(ACCESS);assert.equal(r.status,403);assert.deepEqual(r.body,{allowed:false,role:null,reason:'identity_inactive'});});
test('malformed request URL gets 400 and the server keeps serving',async()=>{
 await withServer(makeHandler(),async(base,port)=>{
  const raw=await rawRequest(port,'GET http://[::1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  assert.match(raw,/^HTTP\/1\.1 400 /);assert.match(raw,/invalid_url/);
  const after=await fetch(`${base}/healthz`);assert.equal(after.status,200);
 });
});
test('handler exception returns 500 and the server keeps serving',async()=>{
 await withServer(makeHandler({adminHandler:async()=>{throw Error('boom')}}),async base=>{
  const r=await fetch(`${base}/v1/admin/oidc/plans`);assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:'internal_error'});
  assert.equal((await fetch(`${base}/healthz`)).status,200);
 });
});
test('per-IP limit returns 429 with Retry-After before token verification',async()=>{
 let verifications=0;
 await withServer(makeHandler({verify:async()=>{verifications++;return principal},rateLimits:{ip:{limit:2,windowMs:60_000},subject:{limit:100,windowMs:60_000}}}),async base=>{
  const statuses=[];let last;
  for(let i=0;i<3;i++){last=await fetch(`${base}${ACCESS}`,{headers:{authorization:'Bearer abc.def.ghi'}});statuses.push(last.status);}
  assert.deepEqual(statuses,[403,403,429]);assert.ok(Number(last.headers.get('retry-after'))>=1);assert.equal(verifications,2);
 });
});
test('per-subject limit applies across client addresses',async()=>{
 let n=0;
 await withServer(makeHandler({clientIp:()=>`client-${n++}`,rateLimits:{ip:{limit:100,windowMs:60_000},subject:{limit:1,windowMs:60_000}}}),async base=>{
  const statuses=[];for(let i=0;i<2;i++)statuses.push((await fetch(`${base}${ACCESS}`,{headers:{authorization:'Bearer abc.def.ghi'}})).status);
  assert.deepEqual(statuses,[403,429]);
 });
});
test('decision logs record allow and deny without tokens or subjects',async()=>{
 const lines=[];const logger=createJsonLogger({write:l=>lines.push(l),clock:()=>'2026-01-01T00:00:00.000Z'});
 await withServer(makeHandler({query:async sql=>allowRows(sql),logger}),async base=>{
  await fetch(`${base}${ACCESS}`,{headers:{authorization:'Bearer abc.def.ghi'}});
 });
 await withServer(makeHandler({logger}),async base=>{await fetch(`${base}${ACCESS}`,{headers:{authorization:'Bearer abc.def.ghi'}});});
 const events=lines.map(l=>JSON.parse(l));
 const allow=events.find(e=>e.event==='access_decision'&&e.decision==='allow');
 const deny=events.find(e=>e.event==='access_decision'&&e.decision==='deny');
 assert.equal(allow.application,'desk');assert.equal(allow.status,200);assert.equal(deny.reason,'identity_inactive');assert.equal(deny.status,403);
 const everything=lines.join('\n');
 assert.ok(!everything.includes('user1'),'subject must not be logged');
 assert.ok(!everything.includes('abc.def.ghi'),'token must not be logged');
});

test('concurrent expensive access checks reject extra requests before token verification and free capacity',async()=>{
 let enter,releaseVerification;
 const started=new Promise(resolve=>enter=resolve);
 const pending=new Promise(resolve=>releaseVerification=resolve);
 let checks=0;
 const handler=makeHandler({verify:async()=>{checks++;enter();await pending;return principal;},
  concurrencyLimits:{perKey:1,globalLimit:1}});
 await withServer(handler,async base=>{
  const request=()=>fetch(base+ACCESS,{headers:{authorization:'Bearer abc.def.ghi'}});
  const first=request();
  await started;
  const rejected=await request();
  assert.equal(rejected.status,429);
  assert.equal(rejected.headers.get('retry-after'),'1');
  assert.equal(checks,1,'rejected request must not perform token verification');
  releaseVerification();
  const completed=await first;
  assert.equal(completed.status,403);
  const after=await request();
  assert.equal(after.status,403);
  assert.equal(checks,2);
 });
});
test('invalid concurrent capacity is rejected before server binds',()=>{
 assert.throws(()=>makeHandler({concurrencyLimits:{perKey:0,globalLimit:2}}),TypeError);
});