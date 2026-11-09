import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralOidcBrowserHandler} from '../src/central-oidc-browser.mjs';

const COMPANY='00000000-0000-4000-8000-000000000001';
const SECOND='00000000-0000-4000-8000-000000000002';
const makeRes=()=>({status:0,headers:{},body:null,writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}});
const verified={subject:'issuer|subject',issuer:'https://issuer.example'};
const callback=(binding,path='/auth/central/callback?state=valid-state&code=valid-code')=>({method:'GET',url:path,headers:{cookie:binding}});
function setup({entries=[{companyId:COMPANY,authorised:true}],approved=true,complete=async()=>verified}={}){
  const calls=[];
  const handler=createCentralOidcBrowserHandler({
    oidcLogin:{async begin({browserBinding}){calls.push(['begin',browserBinding]);return {authorizationUrl:'https://issuer.example/oidc/auth?state=abc'};},
      async complete(args){calls.push(['complete',args]);return complete(args)}},
    sessions:{async issue(args){calls.push(['issue',args]);return {cookie:'__Host-titan-central='+ 'Y'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800'}}},
    async listEligibleCompanies(identity){calls.push(['eligible',identity]);return entries;},
    async recheckCompany(identity){calls.push(['recheck',identity]);return approved;},
    clientIp:()=> 'test-client'
  });
  return {handler,calls};
}
async function start(handler){
  const res=makeRes();
  assert.equal(await handler({method:'GET',url:'/auth/central/start',headers:{}},res),true);
  assert.equal(res.status,303);
  return res.headers['set-cookie'].split(';')[0];
}
test('start produces host-only correlation cookie and redirects to configured issuer',async()=>{
  const {handler,calls}=setup();
  const res=makeRes();
  await handler({method:'GET',url:'/auth/central/start',headers:{}},res);
  assert.equal(res.status,303);
  assert.equal(res.headers.location,'https://issuer.example/oidc/auth?state=abc');
  assert.match(res.headers['set-cookie'],/^__Host-titan-central-oidc=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  assert.equal(calls[0][0],'begin');
});
test('verified callback selects sole eligible company, rechecks then creates session',async()=>{
  const {handler,calls}=setup();
  const binding=await start(handler);
  const res=makeRes();
  await handler(callback(binding),res);
  assert.equal(res.status,303);
  assert.equal(res.headers.location,'/central');
  assert.equal(res.headers['set-cookie'].length,2);
  assert.match(res.headers['set-cookie'][1],/^__Host-titan-central=/);
  assert.deepEqual(calls.slice(1).map(c=>c[0]),['complete','eligible','recheck','issue']);
  assert.deepEqual(calls.at(-1)[1],{identityId:'issuer|subject',companyId:COMPANY});
});
test('two eligible companies require explicit selection, no session created',async()=>{
  const {handler,calls}=setup({entries:[{companyId:COMPANY,authorised:true},{companyId:SECOND,authorised:true}]});
  const res=makeRes();await handler(callback(await start(handler)),res);
  assert.equal(res.status,403);assert.deepEqual(JSON.parse(res.body),{error:'company_selection_required'});
  assert.equal(calls.some(c=>c[0]==='issue'),false);
});
test('revoked membership between lookup and session issue denies access',async()=>{
  const {handler,calls}=setup({approved:false});
  const res=makeRes();await handler(callback(await start(handler)),res);
  assert.equal(res.status,403);
  assert.equal(calls.some(c=>c[0]==='issue'),false);
});
test('foreign, untrusted and duplicate company responses cannot issue sessions',async()=>{
  for(const entries of [[{companyId:SECOND,authorised:false}],[{companyId:'attacker',authorised:true}],[]]){
    const {handler,calls}=setup({entries});
    const res=makeRes();await handler(callback(await start(handler)),res);
    assert.equal(res.status,403);assert.equal(calls.some(c=>c[0]==='issue'),false);
  }
});
test('rejects duplicate callback params, injected company and duplicate binding cookie before completing OIDC',async()=>{
  for(const path of ['/auth/central/callback?state=a&state=b&code=x','/auth/central/callback?state=a&code=b&company_id='+SECOND]){
    const {handler,calls}=setup();const binding=await start(handler);const res=makeRes();
    await handler(callback(binding,path),res);
    assert.equal(res.status,400);assert.equal(calls.some(c=>c[0]==='complete'),false);
  }
  const {handler,calls}=setup();const binding=await start(handler);
  const res=makeRes();await handler(callback(binding+'; '+binding),res);
  assert.equal(res.status,400);assert.equal(calls.some(c=>c[0]==='complete'),false);
});
test('OIDC verification failure does not call membership or session layers',async()=>{
  const {handler,calls}=setup({complete:async()=>{throw Error('bad signature')}});
  const res=makeRes();await handler(callback(await start(handler)),res);
  assert.equal(res.status,401);assert.equal(calls.some(c=>c[0]==='eligible'||c[0]==='issue'),false);
  assert.doesNotMatch(res.body,/signature/);
});
test('unrecognised routes and methods are not consumed or approved',async()=>{
  const {handler}=setup();const res=makeRes();
  assert.equal(await handler({method:'GET',url:'/central',headers:{}},res),false);
  assert.equal(res.status,0);
  await handler({method:'POST',url:'/auth/central/callback',headers:{}},res);
  assert.equal(res.status,405);
});
test('unexpected login parameters fail before OIDC start',async()=>{
  const {handler,calls}=setup();const res=makeRes();
  await handler({method:'GET',url:'/auth/central/start?company_id='+SECOND,headers:{}},res);
  assert.equal(res.status,400);assert.equal(calls.length,0);
});

test('central callback concurrency rejects token-exchange fanout and releases cap',async()=>{
 let signal,finish;
 const entered=new Promise(resolve=>signal=resolve);
 const blocked=new Promise(resolve=>finish=resolve);
 let calls=0;
 const handler=createCentralOidcBrowserHandler({
  oidcLogin:{begin:async()=>({authorizationUrl:'https://issuer.example/auth'}),
   complete:async()=>{calls++;signal();await blocked;return verified}},
  sessions:{issue:async()=>({cookie:'__Host-titan-central='+ 'Z'.repeat(43)+'; Secure; HttpOnly; SameSite=Lax'})},
  listEligibleCompanies:async()=>[{companyId:COMPANY,authorised:true}],
  recheckCompany:async()=>true,
  concurrencyLimits:{perKey:1,globalLimit:1},clientIp:()=> 'same-socket'
 });
 const cookie='__Host-titan-central-oidc='+'A'.repeat(43);
 const one=makeRes();
 const first=handler(callback(cookie),one);
 await entered;
 const rejected=makeRes();
 await handler(callback(cookie),rejected);
 assert.equal(rejected.status,429);
 assert.equal(calls,1);
 finish();await first;
 const third=makeRes();await handler(callback(cookie),third);
 assert.equal(third.status,303);
 assert.equal(calls,2);
});

test('OIDC company list never includes denied candidates in selection handoff',async()=>{
 const seen=[];
 const handler=createCentralOidcBrowserHandler({
  oidcLogin:{begin:async()=>({authorizationUrl:'https://issuer.example/oidc'}),
   complete:async()=>verified},
  sessions:{issue:async()=>{throw Error('should not issue')}},
  listEligibleCompanies:async()=>[
   {companyId:COMPANY,authorised:true},
   {companyId:SECOND,authorised:true},
   {companyId:'00000000-0000-4000-8000-000000000099',authorised:false}
  ],
  recheckCompany:async()=>true,
  selectionFlow:{begin:async(input,response)=>{seen.push(input);response.writeHead(200,{});response.end('selection')},handle:async()=>true}
 });
 const res=makeRes();
 await handler(callback('__Host-titan-central-oidc='+'A'.repeat(43)),res);
 assert.equal(res.status,200);
 assert.deepEqual(seen[0].allowedCompanyIds,[COMPANY,SECOND]);
});
test('duplicate, malformed or untyped company membership results never issue a session',async()=>{
 for(const entries of [
  [{companyId:COMPANY,authorised:true},{companyId:COMPANY,authorised:true}],
  [{companyId:COMPANY,authorised:'true'}],
  [{companyId:'invalid',authorised:true}]
 ]){
  let issued=0;
  const handler=createCentralOidcBrowserHandler({
   oidcLogin:{begin:async()=>({authorizationUrl:'https://issuer.example'}),
    complete:async()=>verified},
   sessions:{issue:async()=>{issued++}},
   listEligibleCompanies:async()=>entries,recheckCompany:async()=>true
  });
  const res=makeRes();
  await handler(callback('__Host-titan-central-oidc='+'A'.repeat(43)),res);
  assert.equal(res.status,403);
  assert.equal(issued,0);
 }
});
