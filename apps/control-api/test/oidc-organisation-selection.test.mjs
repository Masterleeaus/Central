// Issue #32: organisation selection for multi-organisation users. No sockets, no database.
// The in-memory selection store below is a test double. Production needs a durable, shared, atomic store:
// save(record) keyed by bindingHash, and consume(bindingHash) that returns and deletes the record in one step.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createVerifiedIdentityResolver} from '../src/oidc-app-session.mjs';
import {createOidcHttpAdapter} from '../src/oidc-http-adapter.mjs';
import {createIdTokenVault} from '../src/oidc-id-token-store.mjs';

const ISSUER='https://auth.titan.example';
const SUB='sub-A';
const BIND_A='A'.repeat(43);
const BIND_B='B'.repeat(43);
const ENV={TITAN_OIDC_STATE_KEY:Buffer.alloc(32,3).toString('base64')};
const makeRes=()=>({status:null,headers:null,body:'',writeHead(s,h){this.status=s;this.headers=h},end(s=''){this.body=s}});
const cookiesOf=res=>[].concat(res.headers?.['set-cookie']??[]);

// Central membership directory, mutated by tests to simulate revocation between listing and selection.
function directory(seed={}){
  const d={membership:{...(seed.membership??{})},entitled:new Set(seed.entitled??[]),active:new Set(seed.active??[]),lookupFails:false,lookups:0,authorised:[]};
  d.findOrganisationIds=async({subject})=>{d.lookups++;if(d.lookupFails)throw Error('db down');return [...(d.membership[subject]??[])]};
  d.authorise=async({principal,organisationId,applicationId,action})=>{
    d.authorised.push({subject:principal.logtoSubject,organisationId,action});
    if(!d.entitled.has(organisationId))return {allowed:false,reason:'no_membership'};
    return {allowed:true,applicationId,organisationId,localUserId:`user-${principal.logtoSubject}-${organisationId}`,localAccountId:`acct-${principal.logtoSubject}-${organisationId}`,role:'member'};
  };
  d.localAccountActive=async({organisationId})=>d.active.has(organisationId);
  return d;
}
const resolverFor=d=>createVerifiedIdentityResolver({applicationId:'desk',issuer:ISSUER,audience:'desk-client',findOrganisationIds:d.findOrganisationIds,authorise:d.authorise,localAccountActive:d.localAccountActive});

// One-use selection store: the test double for the durable store.
function memorySelectionStore(){
  const records=new Map();let saves=0;
  return {
    get size(){return records.size},get saves(){return saves},
    async save(record){saves++;records.set(record.bindingHash,{...record});},
    async consume(bindingHash){const r=records.get(bindingHash)??null;records.delete(bindingHash);return r;}
  };
}

function world({subject=SUB,dir=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a','org-b']}),store=memorySelectionStore(),vault=null,storeIdToken=null,now={t:1_800_000_000_000},withSelection=true,logs=[]}={}){
  const established=[];const stored=[];
  const adapter=createOidcHttpAdapter({applicationId:'desk',afterLogin:'/workspace',clock:()=>now.t,
    logger:(event,fields)=>logs.push({event,fields}),
    oidcLogin:{begin:async()=>({authorizationUrl:`${ISSUER}/oidc/auth`}),complete:async()=>({subject,issuer:ISSUER,idToken:'h.p.s'})},
    resolveLocalIdentity:resolverFor(dir),
    establishSession:async args=>{established.push(args);return {cookie:`desk_sid=${'k'.repeat(40)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`,sessionId:`sid_${established.length}_xxxxxx`}},
    organisationSelection:withSelection?{store,resolveOrganisation:resolverFor(dir).resolveOrganisation}:null,
    idTokenVault:vault,storeIdToken:vault?(storeIdToken??(async a=>stored.push(a))):null});
  return {adapter,established,stored,store,dir,now,logs};
}
const callback=(w,binding=BIND_A,query='state=s&code=c')=>{const res=makeRes();return w.adapter({url:`/auth/titan/desk/callback?${query}`,method:'GET',headers:{cookie:`titan_desk_oidc_binding=${binding}`}},res).then(()=>res);};
function post({body,binding=BIND_A,headers={},url='/auth/titan/desk/select-organisation',method='POST',rawBody}={}){
  const h={'content-type':'application/json','sec-fetch-site':'same-origin',...headers};
  if(binding!==null)h.cookie=`titan_desk_oidc_binding=${binding}`;
  const payload=rawBody??(body===undefined?'':JSON.stringify(body));
  const req=Object.assign(Readable.from(payload===''?[]:[Buffer.from(payload)]),{method,url,headers:h,socket:{remoteAddress:'10.0.0.1'}});
  return req;
}
const select=async(w,opts)=>{const res=makeRes();await w.adapter(post(opts),res);return res;};
// Starts a multi-organisation sign-in in the browser with BIND_A and returns the selection token.
async function startLogin(w,binding=BIND_A){const res=await callback(w,binding);assert.equal(res.status,200,'selection listed');return JSON.parse(res.body);}

// Resolver: the selection listing and the fresh re-check.
test('several eligible organisations are listed, and only those returned by trusted lookup',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b','org-c']},entitled:['org-a','org-b'],active:['org-a','org-b']});
  const out=await resolverFor(d)({issuer:ISSUER,subject:SUB,applicationId:'desk'});
  assert.deepEqual(out,{authorised:false,selectionRequired:true,organisationIds:['org-a','org-b']});
  assert.deepEqual(d.authorised.map(a=>a.organisationId),['org-a','org-b','org-c']);
});
test('an organisation whose local account is inactive is not listed',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a']});
  const out=await resolverFor(d)({issuer:ISSUER,subject:SUB,applicationId:'desk'});
  assert.deepEqual(out,{authorised:true,localUserId:`user-${SUB}-org-a`,localAccountId:`acct-${SUB}-org-a`,organisationId:'org-a'});
});
test('no eligible organisation stays unauthorised',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:[]});
  assert.equal((await resolverFor(d)({issuer:ISSUER,subject:SUB,applicationId:'desk'})).authorised,false);
});
test('a decision for a different organisation or application refuses the whole sign-in',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b']});
  const forged=createVerifiedIdentityResolver({applicationId:'desk',issuer:ISSUER,audience:'desk-client',findOrganisationIds:d.findOrganisationIds,
    authorise:async({organisationId})=>({allowed:true,applicationId:'desk',organisationId:organisationId==='org-a'?'org-z':organisationId,localUserId:'u',localAccountId:'a'}),localAccountActive:async()=>true});
  assert.equal((await forged({issuer:ISSUER,subject:SUB,applicationId:'desk'})).selectionRequired,undefined);
  assert.equal((await forged({issuer:ISSUER,subject:SUB,applicationId:'desk'})).authorised,false);
  const otherApp=createVerifiedIdentityResolver({applicationId:'desk',issuer:ISSUER,audience:'desk-client',findOrganisationIds:d.findOrganisationIds,
    authorise:async({organisationId})=>({allowed:true,applicationId:'field',organisationId,localUserId:'u',localAccountId:'a'}),localAccountActive:async()=>true});
  assert.equal((await otherApp({issuer:ISSUER,subject:SUB,applicationId:'desk'})).authorised,false);
});
test('a failing membership lookup fails closed in the listing',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b']});d.lookupFails=true;
  assert.equal((await resolverFor(d)({issuer:ISSUER,subject:SUB,applicationId:'desk'})).authorised,false);
});
test('resolveOrganisation re-checks membership, entitlement and local account for the selected organisation',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a','org-b']});
  const r=resolverFor(d).resolveOrganisation;
  assert.deepEqual(await r({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org-b'}),{authorised:true,localUserId:`user-${SUB}-org-b`,localAccountId:`acct-${SUB}-org-b`,organisationId:'org-b'});
  assert.ok(d.lookups>=1);
});
test('resolveOrganisation refuses an organisation revoked from the fresh membership lookup',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a','org-b']});
  d.membership[SUB]=['org-a'];
  assert.equal((await resolverFor(d).resolveOrganisation({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org-b'})).authorised,false);
});
test('resolveOrganisation refuses an entitlement revoked since listing',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a','org-b']});
  d.entitled.delete('org-b');
  assert.equal((await resolverFor(d).resolveOrganisation({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org-b'})).authorised,false);
});
test('resolveOrganisation refuses an inactive local account and a failing lookup',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a']});
  assert.equal((await resolverFor(d).resolveOrganisation({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org-b'})).authorised,false);
  d.lookupFails=true;
  assert.equal((await resolverFor(d).resolveOrganisation({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org-a'})).authorised,false);
});
test('resolveOrganisation refuses foreign subjects, issuers, applications and malformed ids',async()=>{
  const d=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b'],active:['org-a','org-b']});
  const r=resolverFor(d).resolveOrganisation;
  assert.equal((await r({issuer:ISSUER,subject:'sub-OTHER',applicationId:'desk',organisationId:'org-a'})).authorised,false);
  assert.equal((await r({issuer:'https://evil.example',subject:SUB,applicationId:'desk',organisationId:'org-a'})).authorised,false);
  assert.equal((await r({issuer:ISSUER,subject:SUB,applicationId:'field',organisationId:'org-a'})).authorised,false);
  assert.equal((await r({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org a'})).authorised,false);
  assert.equal((await r({issuer:ISSUER,subject:SUB,applicationId:'desk'})).authorised,false);
});
test('resolveOrganisation refuses an organisation that is not in the lookup even if authorise would allow it',async()=>{
  const d=directory({membership:{[SUB]:['org-a']},entitled:['org-a','org-z'],active:['org-a','org-z']});
  assert.equal((await resolverFor(d).resolveOrganisation({issuer:ISSUER,subject:SUB,applicationId:'desk',organisationId:'org-z'})).authorised,false);
});

// Adapter: the selection step.
test('multi-organisation callback lists only trusted organisations and creates no session',async()=>{
  const w=world();const res=await callback(w);
  assert.equal(res.status,200);
  const body=JSON.parse(res.body);
  assert.equal(body.status,'select_organisation');
  assert.deepEqual(body.organisations,['org-a','org-b']);
  assert.match(body.selection_token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(w.established.length,0);
  assert.equal(res.headers['set-cookie'],undefined,'binding cookie is kept for the selection step, no session cookie');
  assert.equal(w.store.size,1);
});
test('the selection listing never exposes local ids or the raw ID token',async()=>{
  const w=world();const res=await callback(w);
  assert.equal(res.body.includes('user-'),false);assert.equal(res.body.includes('acct-'),false);assert.equal(res.body.includes('h.p.s'),false);
});
test('explicit selection creates a session for exactly the chosen organisation',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  const res=await select(w,{body:{organisation_id:'org-b',selection_token}});
  assert.equal(res.status,303);assert.equal(res.headers.location,'/workspace');
  assert.equal(w.established.length,1);
  assert.equal(w.established[0].organisationId,'org-b');assert.equal(w.established[0].localAccountId,`acct-${SUB}-org-b`);assert.equal(w.established[0].oidcSubject,SUB);
  const cookies=cookiesOf(res);assert.equal(cookies.length,2);assert.match(cookies[0],/^titan_desk_oidc_binding=; .*Max-Age=0$/);
});
test('a replayed selection is refused, because the pending record is one-use',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,303);
  const again=await select(w,{body:{organisation_id:'org-a',selection_token}});
  assert.equal(again.status,403);assert.equal(w.established.length,1);
});
test('an organisation outside the listed set is refused (foreign selection), and ends that pending selection',async()=>{
  const dir=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a','org-b','org-c'],active:['org-a','org-b','org-c']});
  const w=world({dir});const {selection_token}=await startLogin(w);
  const res=await select(w,{body:{organisation_id:'org-c',selection_token}});
  assert.equal(res.status,403);assert.equal(JSON.parse(res.body).error,'selection_rejected');assert.equal(w.established.length,0);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,403,'the pending selection is spent');
});
test('a tampered selection token is refused and spends the pending selection',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  const bad=(selection_token[0]==='A'?'B':'A')+selection_token.slice(1);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token:bad}})).status,403);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,403);
  assert.equal(w.established.length,0);
});
test('a selection from another browser cannot use this browser pending selection, and the owner can still finish',async()=>{
  const w=world();const {selection_token}=await startLogin(w,BIND_A);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token},binding:BIND_B})).status,403);
  assert.equal(w.established.length,0);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token},binding:BIND_A})).status,303);
  assert.equal(w.established.length,1);
});
test('a selection without a browser binding cookie is refused',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token},binding:null})).status,403);
  assert.equal(w.established.length,0);
});
test('a membership revoked between listing and selection is refused, with no session',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  w.dir.membership[SUB]=['org-a'];
  const res=await select(w,{body:{organisation_id:'org-b',selection_token}});
  assert.equal(res.status,403);assert.equal(JSON.parse(res.body).error,'account_not_authorised');
  assert.equal(w.established.length,0);
});
test('an entitlement revoked between listing and selection is refused, with no session',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  w.dir.entitled.delete('org-b');
  const res=await select(w,{body:{organisation_id:'org-b',selection_token}});
  assert.equal(res.status,403);assert.equal(JSON.parse(res.body).error,'account_not_authorised');
  assert.equal(w.established.length,0);
});
test('a local account deactivated between listing and selection is refused',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  w.dir.active.delete('org-a');
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,403);
  assert.equal(w.established.length,0);
});
test('a failing membership lookup at selection fails closed with 403 and no session',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  w.dir.lookupFails=true;
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,403);
  assert.equal(w.established.length,0);
});
test('an expired pending selection is refused',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  w.now.t+=300_001;
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,403);
  assert.equal(w.established.length,0);
});
test('a selection store that fails closes the selection with 503',async()=>{
  const store=memorySelectionStore();const w=world({store});const {selection_token}=await startLogin(w);
  store.consume=async()=>{throw Error('store down')};
  const res=await select(w,{body:{organisation_id:'org-a',selection_token}});
  assert.equal(res.status,503);assert.equal(w.established.length,0);
});
test('with no selection store configured, several organisations still fail closed (403)',async()=>{
  const w=world({withSelection:false});const res=await callback(w);
  assert.equal(res.status,403);assert.equal(JSON.parse(res.body).error,'account_not_authorised');assert.equal(w.established.length,0);
});
test('the selection route is not available without a selection store',async()=>{
  const w=world({withSelection:false});const res=makeRes();await w.adapter(post({body:{organisation_id:'org-a',selection_token:'A'.repeat(43)}}),res);
  assert.equal(res.status,404);
});
test('a single eligible organisation still signs in directly, with no selection step',async()=>{
  const dir=directory({membership:{[SUB]:['org-a','org-b']},entitled:['org-a'],active:['org-a']});
  const w=world({dir});const res=await callback(w);
  assert.equal(res.status,303);assert.equal(w.established[0].organisationId,'org-a');assert.equal(w.store.size,0);
});

// Request shape and origin checks on the selection route.
test('the selection route answers GET with 405 and never changes state',async()=>{
  const w=world();await startLogin(w);
  const res=makeRes();await w.adapter({url:'/auth/titan/desk/select-organisation',method:'GET',headers:{cookie:`titan_desk_oidc_binding=${BIND_A}`}},res);
  assert.equal(res.status,405);assert.equal(w.established.length,0);
});
test('cross-site or missing Sec-Fetch-Site is refused before the pending record is touched',async()=>{
  const w=world();const {selection_token}=await startLogin(w);const saves=w.store.saves;
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token},headers:{'sec-fetch-site':'cross-site'}})).status,403);
  const missing=post({body:{organisation_id:'org-a',selection_token}});delete missing.headers['sec-fetch-site'];
  const r=makeRes();await w.adapter(missing,r);assert.equal(r.status,403);
  assert.equal(w.store.size,1);assert.equal(w.store.saves,saves);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,303);
});
test('a non-JSON content type is refused (a cross-site form cannot send JSON)',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token},headers:{'content-type':'application/x-www-form-urlencoded'}})).status,400);
  assert.equal(w.established.length,0);
});
test('malformed bodies are refused: extra keys, missing keys, wrong types, bad formats and oversized payloads',async()=>{
  const w=world();const {selection_token}=await startLogin(w);
  const cases=[
    {organisation_id:'org-a',selection_token,extra:1},
    {organisation_id:'org-a'},
    {selection_token},
    {organisation_id:['org-a'],selection_token},
    {organisation_id:'org a',selection_token},
    {organisation_id:'org-a',selection_token:'short'},
    {organisation_id:'org-a',selection_token:'A'.repeat(43)+'\n'},
  ];
  for(const body of cases) assert.equal((await select(w,{body})).status,400,JSON.stringify(body));
  assert.equal((await select(w,{rawBody:'['})).status,400);
  assert.equal((await select(w,{rawBody:'{"organisation_id":"'+'x'.repeat(600)+'"}'})).status,400);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token},url:'/auth/titan/desk/select-organisation?x=1'})).status,400);
  assert.equal(w.established.length,0);
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,303,'malformed bodies never consumed the pending selection');
});
test('a selection request with no pending record for its browser is refused',async()=>{
  const w=world();
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token:'A'.repeat(43)}})).status,403);
});

// Account switching: a second sign-in in another browser never reuses the first browser's selection or session.
test('account switching: a selection token from one account cannot finish another account, and sessions stay per account',async()=>{
  const dir=directory({membership:{'sub-A':['org-a','org-b'],'sub-B':['org-c','org-d']},entitled:['org-a','org-b','org-c','org-d'],active:['org-a','org-b','org-c','org-d']});
  let who='sub-A';const established=[];const store=memorySelectionStore();
  const adapter=createOidcHttpAdapter({applicationId:'desk',afterLogin:'/',clock:()=>1_800_000_000_000,
    oidcLogin:{begin:async()=>({authorizationUrl:`${ISSUER}/oidc/auth`}),complete:async()=>({subject:who,issuer:ISSUER,idToken:'h.p.s'})},
    resolveLocalIdentity:resolverFor(dir),establishSession:async a=>{established.push(a);return {cookie:`desk_sid=${'k'.repeat(40)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`,sessionId:`sid_${established.length}_yyyyyy`}},
    organisationSelection:{store,resolveOrganisation:resolverFor(dir).resolveOrganisation}});
  const run=async(req)=>{const res=makeRes();await adapter(req,res);return res;};
  const cbA=await run({url:'/auth/titan/desk/callback?state=s&code=c',method:'GET',headers:{cookie:`titan_desk_oidc_binding=${BIND_A}`}});
  const tokenA=JSON.parse(cbA.body).selection_token;
  who='sub-B';
  const cbB=await run({url:'/auth/titan/desk/callback?state=s&code=c',method:'GET',headers:{cookie:`titan_desk_oidc_binding=${BIND_B}`}});
  const tokenB=JSON.parse(cbB.body).selection_token;
  assert.deepEqual(JSON.parse(cbB.body).organisations,['org-c','org-d']);
  // Browser B presents A's token: refused. B's own pending record is spent, and A's record is untouched.
  assert.equal((await run(post({body:{organisation_id:'org-c',selection_token:tokenA},binding:BIND_B}))).status,403);
  assert.equal(established.length,0);
  // A finishes with its own token and its own organisation: one session, for sub-A only.
  const ok=await run(post({body:{organisation_id:'org-b',selection_token:tokenA},binding:BIND_A}));
  assert.equal(ok.status,303);
  assert.equal(established.length,1);
  assert.equal(established[0].oidcSubject,'sub-A');assert.equal(established[0].organisationId,'org-b');
  assert.ok(tokenB);
});
test('account switching: a session is never issued for the previous account when the new sign-in is multi-organisation',async()=>{
  const dir=directory({membership:{'sub-A':['org-a','org-b'],'sub-B':['org-c','org-d']},entitled:['org-a','org-b','org-c','org-d'],active:['org-a','org-b','org-c','org-d']});
  let who='sub-A';const established=[];
  const adapter=createOidcHttpAdapter({applicationId:'desk',afterLogin:'/',clock:()=>1_800_000_000_000,
    oidcLogin:{begin:async()=>({authorizationUrl:`${ISSUER}/oidc/auth`}),complete:async()=>({subject:who,issuer:ISSUER,idToken:'h.p.s'})},
    resolveLocalIdentity:resolverFor(dir),establishSession:async a=>{established.push(a);return `desk_sid=${'k'.repeat(40)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`},
    organisationSelection:{store:memorySelectionStore(),resolveOrganisation:resolverFor(dir).resolveOrganisation}});
  const run=async(req)=>{const res=makeRes();await adapter(req,res);return res;};
  await run({url:'/auth/titan/desk/callback?state=s&code=c',method:'GET',headers:{cookie:`titan_desk_oidc_binding=${BIND_A}`}});
  who='sub-B';
  const res=await run({url:'/auth/titan/desk/callback?state=s&code=c',method:'GET',headers:{cookie:`titan_desk_oidc_binding=${BIND_A}`}});
  assert.equal(res.status,200);assert.deepEqual(JSON.parse(res.body).organisations,['org-c','org-d']);
  assert.equal(established.length,0);
});

// Sealed ID token travels with the selection.
test('the ID token is sealed for the new session when an organisation is selected',async()=>{
  const vault=createIdTokenVault({applicationId:'desk',env:ENV});
  const w=world({vault});const {selection_token}=await startLogin(w);
  assert.equal(w.stored.length,0);
  assert.equal((await select(w,{body:{organisation_id:'org-b',selection_token}})).status,303);
  assert.equal(w.stored.length,1);
  const [s]=w.stored;
  assert.equal(s.subject,SUB);assert.equal(vault.open({sealed:s.sealed,sessionId:s.sessionId,subject:SUB}),'h.p.s');
  assert.equal(JSON.stringify(s).includes('h.p.s'),false);
});
test('with an ID-token vault, a selection that fails the re-check never stores or seals a token',async()=>{
  const vault=createIdTokenVault({applicationId:'desk',env:ENV});
  const w=world({vault});const {selection_token}=await startLogin(w);
  w.dir.entitled.delete('org-a');
  assert.equal((await select(w,{body:{organisation_id:'org-a',selection_token}})).status,403);
  assert.equal(w.stored.length,0);assert.equal(w.established.length,0);
});

test('logs record the selection outcome as fields only, never tokens or organisation lists in error text',async()=>{
  const logs=[];const w=world({logs});const {selection_token}=await startLogin(w);
  await select(w,{body:{organisation_id:'org-c',selection_token}});
  const dump=JSON.stringify(logs);
  assert.ok(logs.some(l=>l.event==='login_selection_required'));
  assert.ok(logs.some(l=>l.event==='selection_rejected'));
  assert.equal(dump.includes(selection_token),false);assert.equal(dump.includes(SUB),false);
});
