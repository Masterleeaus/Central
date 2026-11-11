import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createCentralHandler, accessActivityInput, RECORD_TIMEOUT_MS} from '../src/app.mjs';

// Access decisions are written to the activity history (issue #16). These tests cover the recording, the
// redaction of the detail, the failure policy for a recorder outage, and the unchanged response shape.
const ORG='00000000-0000-4000-8000-000000000001';
const AUDIENCES={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const TOKEN='abc.def.ghi';
const SUBJECT='user-subject-secret-1';
const principal={logtoSubject:SUBJECT,issuer:'https://issuer.example',audience:'aud-desk',verifiedAt:new Date().toISOString()};
const ACCESS=`/v1/access/check?organisation_id=${ORG}&application=desk&action=session:open`;
const allowRows=(sql)=>{
 if(sql.startsWith('SELECT id, logto_subject')) return {rows:[{id:'id-1',logto_subject:SUBJECT,state:'active'}]};
 if(sql.startsWith('SELECT id, logto_organisation_id')) return {rows:[{id:ORG,logto_organisation_id:'org-ext',state:'active'}]};
 if(sql.startsWith('SELECT id, identity_id, organisation_id, role')) return {rows:[{id:'m-1',identity_id:'id-1',organisation_id:ORG,role:'member',state:'active',expires_at:null,revision:3}]};
 if(sql.startsWith('SELECT id, organisation_id, application_id')) return {rows:[{id:'e-1',organisation_id:ORG,application_id:'desk',state:'active',features:['session:open'],expires_at:null,revision:4}]};
 if(sql.startsWith('SELECT id, identity_id, organisation_id, application_id')) return {rows:[{id:'l-1',identity_id:'id-1',organisation_id:ORG,application_id:'desk',local_user_id:'lu-1',local_account_id:'la-1',state:'verified',verified_at:'2026-01-01T00:00:00.000Z',revision:5}]};
 return {rows:[]};
};

/** Fake pool that records every statement. `insertError` makes only the activity INSERT fail. */
function fakePool({calls=[],query=async()=>({rows:[]})}={}) {
 return {async connect(){return {
  async query(sql,args){calls.push([sql,args]);return query(sql,args)},
  release(){calls.push(['RELEASE'])},
 }}};
}

function makeHandler({verify=async()=>principal,query=async sql=>allowRows(sql),calls=[],logs=[],activityRecorder,...rest}={}) {
 const pool=fakePool({calls,query});
 return createCentralHandler({pool,verifyToken:verify,issuer:'https://issuer.example',audiences:AUDIENCES,
  healthQuery:async()=>({rows:[]}),logger:(event,fields)=>logs.push({event,fields}),activityRecorder,...rest});
}

async function call(handler,{path=ACCESS,auth=true}={}) {
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 try {
  const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:auth?{authorization:`Bearer ${TOKEN}`}:{}});
  return {status:r.status,body:await r.json()};
 } finally {server.closeAllConnections();server.close();await once(server,'close');}
}

test('an allow is recorded as one success event with the decision and role', async()=>{
 const recorded=[];
 const r=await call(makeHandler({activityRecorder:async input=>{recorded.push(input);return 'id'}}));
 assert.equal(r.status,200);
 assert.equal(recorded.length,1);
 const e=recorded[0];
 assert.equal(e.organisationId,ORG);
 assert.equal(e.outcome,'success');
 assert.equal(e.action,'access.check');
 assert.equal(e.targetType,'organisation');
 assert.equal(e.targetId,ORG);
 assert.equal(e.sourceProduct,'central');
 assert.deepEqual(e.detail,{decision:'allow',application:'desk',action:'session:open',reason:'allowed',role:'member',status:200});
 assert.match(e.correlationId,/^access-[0-9a-f-]{36}$/);
});

test('a deny is recorded as one denied event with the reason code and status', async()=>{
 const recorded=[];
 const r=await call(makeHandler({verify:async()=>principal,query:async()=>({rows:[]}),activityRecorder:async input=>{recorded.push(input);return 'id'}}));
 assert.equal(r.status,403);
 assert.equal(recorded.length,1);
 assert.equal(recorded[0].outcome,'denied');
 assert.deepEqual(recorded[0].detail,{decision:'deny',application:'desk',action:'session:open',reason:'identity_inactive',status:403});
});

test('response shape is unchanged: exactly allowed, role and reason', async()=>{
 const allow=await call(makeHandler({activityRecorder:async()=>'id'}));
 assert.deepEqual(allow.body,{allowed:true,role:'member',reason:'allowed'});
 const deny=await call(makeHandler({query:async()=>({rows:[]}),activityRecorder:async()=>'id'}));
 assert.deepEqual(deny.body,{allowed:false,role:null,reason:'identity_inactive'});
});

test('requests that make no decision are not recorded', async()=>{
 const recorded=[];
 const rec=async input=>{recorded.push(input);return 'id'};
 assert.equal((await call(makeHandler({activityRecorder:rec}),{auth:false})).status,401);
 assert.equal((await call(makeHandler({activityRecorder:rec,verify:async()=>{throw Error('bad')}}))).status,401);
 assert.equal((await call(makeHandler({activityRecorder:rec}),{path:'/v1/access/check?organisation_id=none&application=desk&action=x'})).status,400);
 assert.equal(recorded.length,0);
});

test('the recorded detail carries no token, no Logto subject and no raw error text', async()=>{
 const recorded=[];
 await call(makeHandler({activityRecorder:async input=>{recorded.push(input);return 'id'}}));
 await call(makeHandler({query:async()=>({rows:[]}),activityRecorder:async input=>{recorded.push(input);return 'id'}}));
 const text=JSON.stringify(recorded);
 assert.equal(text.includes(TOKEN),false);
 assert.equal(text.includes(SUBJECT),false);
 assert.equal(text.includes('user-subject'),false);
 assert.equal(recorded.every(e=>e.actorId==='central-access-check'),true);
});

test('the detail is built only from fixed keys and scalar values', async()=>{
 const input=accessActivityInput({organisationId:ORG,applicationId:'field',action:'read:jobs',decision:{allowed:false,reason:'role_denied'}});
 assert.deepEqual(Object.keys(input.detail).sort(),['action','application','decision','reason','status']);
 assert.equal(Object.values(input.detail).every(v=>v===null||['string','number','boolean'].includes(typeof v)),true);
});

test('a recorder that throws does not change the allow response, and is logged without its message', async()=>{
 const logs=[];
 const secretMessage='connect failed for postgres://user:pw@db';
 const r=await call(makeHandler({logs,activityRecorder:async()=>{throw Object.assign(Error(secretMessage),{name:'ConnectionError'})}}));
 assert.equal(r.status,200);
 assert.deepEqual(r.body,{allowed:true,role:'member',reason:'allowed'});
 const failed=logs.filter(l=>l.event==='activity_record_failed');
 assert.equal(failed.length,1);
 assert.deepEqual(failed[0].fields,{error_class:'ConnectionError',decision:'allow',application:'desk'});
 assert.equal(JSON.stringify(logs).includes(secretMessage),false);
});

test('a recorder failure does not change the deny response either', async()=>{
 const logs=[];
 const r=await call(makeHandler({logs,query:async()=>({rows:[]}),activityRecorder:async()=>{throw Error('refused')}}));
 assert.equal(r.status,403);
 assert.deepEqual(r.body,{allowed:false,role:null,reason:'identity_inactive'});
 assert.equal(logs.filter(l=>l.event==='activity_record_failed').length,1);
});

test('a redaction refusal is a recording failure: nothing is written and the response is unchanged', async()=>{
 const logs=[];
 // The real recorder runs here. A deny reason that the redactor refuses (contains an email) is never written.
 const calls=[];
 const r=await call(makeHandler({calls,logs,query:async()=>({rows:[]}),
  activityRecorder:async input=>{input.detail.reason='jo@example.com';const {recordActivityInOwnTransaction}=await import('../../../packages/control-plane/dist/index.js');return recordActivityInOwnTransaction(fakePool({calls}),input);}}));
 assert.equal(r.status,403);
 assert.deepEqual(r.body,{allowed:false,role:null,reason:'identity_inactive'});
 assert.equal(calls.some(([sql])=>typeof sql==='string'&&sql.includes('INSERT INTO titan.activity_events')),false);
 assert.equal(logs.filter(l=>l.event==='activity_record_failed').length,1);
});

test('the default recorder writes through the writer role with redacted, scoped arguments', async()=>{
 const calls=[];
 const r=await call(makeHandlerWithPool(calls));
 assert.equal(r.status,200);
 const insert=calls.find(([sql])=>typeof sql==='string'&&sql.includes('INSERT INTO titan.activity_events'));
 assert.ok(insert, 'an INSERT into titan.activity_events was issued');
 assert.ok(calls.some(([sql])=>sql==='SET LOCAL ROLE titan_trusted_writer'));
 assert.ok(calls.some(([sql])=>sql==='COMMIT'));
 const args=insert[1];
 assert.equal(args[2],ORG);
 assert.equal(args[3],'service');
 assert.equal(args[4],'central-access-check');
 assert.equal(args[10].startsWith('access-'),true);
 assert.equal(JSON.stringify(args).includes(TOKEN),false);
 assert.equal(JSON.stringify(args).includes(SUBJECT),false);
});

function makeHandlerWithPool(calls) {
 return createCentralHandler({pool:fakePool({calls,query:async sql=>allowRows(sql)}),verifyToken:async()=>principal,issuer:'https://issuer.example',audiences:AUDIENCES,
  healthQuery:async()=>({rows:[]}),logger:()=>{}});
}

test('a recorder that never answers releases the response after the bounded wait', async()=>{
 const started=Date.now();
 const r=await call(makeHandler({activityRecorder:()=>new Promise(()=>{})}));
 const elapsed=Date.now()-started;
 assert.equal(r.status,200);
 assert.deepEqual(r.body,{allowed:true,role:'member',reason:'allowed'});
 assert.ok(elapsed>=RECORD_TIMEOUT_MS-100, `waited ${elapsed} ms`);
 assert.ok(elapsed<RECORD_TIMEOUT_MS+2000, `waited ${elapsed} ms`);
});
