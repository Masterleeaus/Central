import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralOidcBrowserHandler,centralLoginActivityInput} from '../src/central-oidc-browser.mjs';
import {prepareActivityEvent} from '../../../packages/control-plane/dist/index.js';

// Central browser login outcomes are written to the activity history (issue #16, on the #36 recorder).
// These tests cover what is recorded, what is never recorded, and that a recorder outage never changes the login response.
const COMPANY='00000000-0000-4000-8000-000000000001';
const SUBJECT='issuer|subject-secret-42';
const verified={subject:SUBJECT,issuer:'https://issuer.example'};
const SESSION_COOKIE='__Host-titan-central='+'Y'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800';
const makeRes=()=>({status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}});
const callback=(binding)=>({method:'GET',url:'/auth/central/callback?state=valid-state&code=valid-code',headers:{cookie:binding}});

function setup({entries=[{companyId:COMPANY,authorised:true}],approved=true,activityRecorder,logs=[]}={}) {
  const calls=[];
  const handler=createCentralOidcBrowserHandler({
    oidcLogin:{async begin({browserBinding}){return {authorizationUrl:'https://issuer.example/oidc/auth?state=abc'};},
      async complete(){return verified}},
    sessions:{async issue(args){calls.push(['issue',args]);return {cookie:SESSION_COOKIE}}},
    async listEligibleCompanies(){return entries;},
    async recheckCompany(){return approved;},
    clientIp:()=>'test-client',
    logger:(event,fields)=>logs.push({event,fields}),
    activityRecorder,
  });
  return {handler,calls,logs};
}
async function login(handler){
  const start=makeRes();
  await handler({method:'GET',url:'/auth/central/start',headers:{}},start);
  const binding=start.headers['set-cookie'].split(';')[0];
  const res=makeRes();
  await handler(callback(binding),res);
  return res;
}

test('a successful login records one login.succeeded event for the company, without subject or token', async()=>{
  const recorded=[];
  const {handler}=setup({activityRecorder:async input=>{recorded.push(input);return 'id'}});
  const res=await login(handler);
  assert.equal(res.status,303);
  assert.equal(recorded.length,1);
  const e=recorded[0];
  assert.equal(e.action,'login.succeeded');
  assert.equal(e.outcome,'success');
  assert.equal(e.organisationId,COMPANY);
  assert.equal(e.targetId,COMPANY);
  assert.equal(e.sourceProduct,'central');
  assert.equal(e.actorId,'central-oidc-login');
  assert.deepEqual(e.detail,{decision:'allow',reason:'allowed',status:303});
  assert.match(e.correlationId,/^login-[0-9a-f-]{36}$/);
  const text=JSON.stringify(recorded);
  assert.equal(text.includes(SUBJECT),false);
  assert.equal(text.includes('subject'),false);
  assert.equal(text.includes('Y'.repeat(43)),false);
});

test('a company that fails the recheck records one login.denied event and no session is issued', async()=>{
  const recorded=[];
  const {handler,calls}=setup({approved:false,activityRecorder:async input=>{recorded.push(input);return 'id'}});
  const res=await login(handler);
  assert.equal(res.status,403);
  assert.deepEqual(JSON.parse(res.body),{error:'company_access_denied'});
  assert.equal(calls.some(c=>c[0]==='issue'),false);
  assert.equal(recorded.length,1);
  assert.equal(recorded[0].action,'login.denied');
  assert.equal(recorded[0].outcome,'denied');
  assert.deepEqual(recorded[0].detail,{decision:'deny',reason:'company_access_denied',status:403});
});

test('no company chosen yet (selection required) records nothing', async()=>{
  const recorded=[];
  const {handler}=setup({entries:[{companyId:COMPANY,authorised:true},{companyId:'00000000-0000-4000-8000-000000000002',authorised:true}],
    activityRecorder:async input=>{recorded.push(input);return 'id'}});
  const res=await login(handler);
  assert.equal(res.status,403);
  assert.deepEqual(JSON.parse(res.body),{error:'company_selection_required'});
  assert.equal(recorded.length,0);
});

test('a recorder that throws leaves the login response unchanged and logs only the error class', async()=>{
  const logs=[];
  const secret='connect failed for postgres://user:pw@db';
  const {handler}=setup({logs,activityRecorder:async()=>{throw Object.assign(Error(secret),{name:'ConnectionError'})}});
  const res=await login(handler);
  assert.equal(res.status,303);
  assert.equal(res.headers.location,'/central');
  const failed=logs.filter(l=>l.event==='central_login_activity_failed');
  assert.equal(failed.length,1);
  assert.deepEqual(failed[0].fields,{error_class:'ConnectionError',outcome:'success'});
  assert.equal(JSON.stringify(logs).includes(secret),false);
});

test('without a recorder the login behaves exactly as before', async()=>{
  const {handler}=setup();
  const res=await login(handler);
  assert.equal(res.status,303);
  assert.equal(res.headers['set-cookie'].length,2);
});

test('the recorded inputs pass the activity redaction and schema checks used by the real recorder', async()=>{
  const ok=prepareActivityEvent(centralLoginActivityInput({companyId:COMPANY,outcome:'success'}));
  assert.equal(ok.action,'login.succeeded');
  assert.deepEqual(ok.strippedDetailKeys,[]);
  const denied=prepareActivityEvent(centralLoginActivityInput({companyId:COMPANY,outcome:'denied',reason:'company_access_denied'}));
  assert.equal(denied.outcome,'denied');
});
