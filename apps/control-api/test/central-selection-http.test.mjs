import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralSelectionHttp} from '../src/central-selection-http.mjs';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const binding='b'.repeat(43);
const now=Date.now();
const response=()=>({status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(value){this.body=value}});
function req(body,origin='https://central.example'){
  return {url:'/auth/central/select',method:'POST',headers:{origin,cookie:'__Host-titan-central-oidc='+binding,'content-type':'application/x-www-form-urlencoded'},
    async *[Symbol.asyncIterator](){yield Buffer.from(body)}};
}
function fixture({recheck=true}={}){
  const states=new Map(),issued=[];
  const store={async save(key,value){states.set(key,value)},async consume(key){const record=states.get(key);states.delete(key);return record??null}};
  const flow=createCentralSelectionHttp({selectionStore:store,origin:'https://central.example',
    listOrganisations:async()=>[{id:A,name:'<Script> & Co'},{id:B,name:'Bravo Ltd'}],
    recheckCompany:async()=>recheck,
    sessions:{async issue(record){issued.push(record);return {cookie:'__Host-titan-central='+'A'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800'}}}
  });
  return {flow,states,issued};
}
async function page(f){
  const res=response();await f.flow.begin({issuer:'https://issuer.example',subject:'user_1',browserBinding:binding},res);
  assert.equal(res.status,200);
  assert.match(res.headers['content-security-policy'],/form-action 'self'/);
  assert.doesNotMatch(res.body,/<Script>/);
  assert.match(res.body,/&lt;Script&gt; &amp; Co/);
  const state=/name="state" value="([^"]+)"/.exec(res.body)?.[1];
  assert.ok(state);
  return state;
}
test('verified callback renders accessible company radio form with hidden one-use state',async()=>{
  const f=fixture(),state=await page(f);
  assert.ok(f.states.has(state));
  assert.match(f.states.get(state).bindingHash,/^[0-9a-f]{64}$/);
});
test('same-origin POST consumes stored company choice, rechecks and sets fresh session',async()=>{
  const f=fixture(),state=await page(f);
  const res=response();await f.flow.handle(req('state='+state+'&organisation_id='+B),res);
  assert.equal(res.status,303);
  assert.equal(res.headers.location,'/central');
  assert.equal(res.headers['set-cookie'].length,2);
  assert.deepEqual(f.issued,[{identityId:'user_1',companyId:B}]);
  const repeat=response();await f.flow.handle(req('state='+state+'&organisation_id='+B),repeat);
  assert.equal(repeat.status,403);
  assert.equal(f.issued.length,1);
});
test('foreign company and changed browser binding fail before issuing any session',async()=>{
  const f=fixture(),state=await page(f);
  const res=response();
  await f.flow.handle(req('state='+state+'&organisation_id=00000000-0000-4000-8000-000000000099'),res);
  assert.equal(res.status,403);
  assert.equal(f.issued.length,0);
  const next=await page(f);
  const bad=req('state='+next+'&organisation_id='+A);
  bad.headers.cookie='__Host-titan-central-oidc='+'x'.repeat(43);
  const other=response();await f.flow.handle(bad,other);
  assert.equal(other.status,403);assert.equal(f.issued.length,0);
});
test('revoked membership between display and submit is denied',async()=>{
  const f=fixture({recheck:false}),state=await page(f);
  const res=response();await f.flow.handle(req('state='+state+'&organisation_id='+A),res);
  assert.equal(res.status,403);assert.equal(f.issued.length,0);
});
test('cross-origin, extra fields and wrong method are rejected',async()=>{
  const f=fixture(),state=await page(f);
  const cross=response();await f.flow.handle(req('state='+state+'&organisation_id='+A,'https://attacker.example'),cross);
  assert.equal(cross.status,403);
  const extra=response();await f.flow.handle(req('state='+state+'&organisation_id='+A+'&subject=attacker'),extra);
  assert.equal(extra.status,400);
  const wrong=response();await f.flow.handle({method:'GET',url:'/auth/central/select',headers:{}},wrong);
  assert.equal(wrong.status,405);
  assert.equal(f.issued.length,0);
});
