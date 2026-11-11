import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductSelectionHttp} from '../src/product-selection-http.mjs';

const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const C='00000000-0000-4000-8000-000000000003';
const binding='x'.repeat(43),issuer='https://id.example/',subject='subject-123';
const origin='https://product.example';
const res=()=>({status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(body=''){this.body=body}});
function request(state,company,{cookie='titan_field_oidc_binding='+binding,source=origin,site='same-origin',method='POST',path='/auth/titan/field/select'}={}){
 return {url:path,method,headers:{cookie,origin:source,'sec-fetch-site':site,'content-type':'application/x-www-form-urlencoded'},
  async *[Symbol.asyncIterator](){yield Buffer.from('state='+state+'&organisation_id='+company)}};
}
function fixture({recheck=true,authorised=true,organisations=[{id:A,name:'A & Co'},{id:B,name:'Beta'}],
 selectStore,onRotate}={}){
 const state=selectStore??new Map(),calls=[];
 const store={save:async(k,v)=>state.set(k,v),consume:async k=>{const v=state.get(k);state.delete(k);return v}};
 const flow=createProductSelectionHttp({applicationId:'field',origin,selectionStore:store,
  listOrganisations:async x=>{calls.push(['list',x]);return organisations},
  resolveLocalIdentity:async x=>{calls.push(['recheck',x]);return {
   authorised:recheck&&authorised,organisationId:x.organisationId,
   localUserId:'local-'+x.organisationId,localAccountId:'account-'+x.organisationId}},
  establishSession:async x=>{calls.push(['rotate',x]);return onRotate?onRotate(x):'field_sid='+ 'z'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax'},
  afterLogin:'/jobs'
 });
 return {flow,state,calls};
}
async function begin(fixture,allowedCompanyIds){
 const out=res();
 await fixture.flow.begin({issuer,subject,browserBinding:binding,...(allowedCompanyIds?{allowedCompanyIds}:{})},out);
 return {out,state:/name="state" value="([A-Za-z0-9_-]{43})"/.exec(out.body)?.[1]};
}
test('renders only trusted company choices with escaping and accessible radio group',async()=>{
 const x=fixture(),{out,state}=await begin(x);
 assert.equal(out.status,200);
 assert.ok(state);assert.ok(x.state.has(state));
 assert.match(out.body,/A &amp; Co/);
 assert.match(out.body,/fieldset/);
 assert.match(out.body,/name="organisation_id"/);
 assert.doesNotMatch(out.body,/subject-123/);
 assert.match(out.headers['content-security-policy'],/form-action 'self'/);
});
test('selected company rechecked twice before any product session is created',async()=>{
 const x=fixture(),{state}=await begin(x);
 const out=res();await x.flow.handle(request(state,B),out);
 assert.equal(out.status,303);assert.equal(out.headers.location,'/jobs');
 assert.equal(x.calls.filter(y=>y[0]==='recheck').length,2);
 const issued=x.calls.find(y=>y[0]==='rotate')[1];
 assert.equal(issued.organisationId,B);
 assert.equal(issued.applicationId,'field');
 assert.equal(issued.oidcSubject,subject);
 assert.equal(out.headers['set-cookie'].length,2);
});
test('identity and selected account must be current at final check',async()=>{
 let called=0;
 const x=fixture({onRotate:()=>{called++;return 'field_sid='+ 'z'.repeat(43)+'; Secure; HttpOnly; SameSite=Lax'}});
 const {state}=await begin(x),out=res();
 await x.flow.handle(request(state,A),out);
 assert.equal(out.status,303);assert.equal(called,1);
});
test('revoked membership after listing denies session',async()=>{
 const x=fixture({recheck:false}),{state}=await begin(x),out=res();
 await x.flow.handle(request(state,A),out);
 assert.equal(out.status,403);
 assert.equal(x.calls.filter(y=>y[0]==='rotate').length,0);
});
test('foreign and unlisted company cannot mint an app session',async()=>{
 for(const company of [C,'not-a-uuid']){
  const x=fixture(),{state}=await begin(x),out=res();
  await x.flow.handle(request(state,company),out);
  assert.equal(out.status,403);
  assert.equal(x.calls.filter(y=>y[0]==='rotate').length,0);
 }
});
test('state is one-use even when first request is denied',async()=>{
 const x=fixture(),{state}=await begin(x);
 const denied=res();await x.flow.handle(request(state,C),denied);
 const replay=res();await x.flow.handle(request(state,A),replay);
 assert.equal(denied.status,403);assert.equal(replay.status,403);
 assert.equal(x.calls.filter(y=>y[0]==='rotate').length,0);
});
test('wrong browser binding, duplicate binding cookies and cross-origin posts deny',async()=>{
 for(const options of [
  {cookie:'titan_field_oidc_binding='+'q'.repeat(43)},
  {cookie:'titan_field_oidc_binding='+binding+'; titan_field_oidc_binding='+binding},
  {source:'https://evil.example'},
  {site:'cross-site'}
 ]){
  const x=fixture(),{state}=await begin(x),out=res();
  await x.flow.handle(request(state,A,options),out);
  assert.ok([400,403].includes(out.status));
  assert.equal(x.calls.filter(y=>y[0]==='rotate').length,0);
 }
});
test('missing or duplicate form fields are rejected without consuming pending state',async()=>{
 const x=fixture(),{state}=await begin(x);
 for(const raw of ['state='+state+'&organisation_id='+A+'&organisation_id='+B,
  'state='+state+'&organisation_id='+A+'&admin=true']){
  const requestBody={...request(state,A),
   async *[Symbol.asyncIterator](){yield Buffer.from(raw)}};
  const out=res();await x.flow.handle(requestBody,out);
  assert.equal(out.status,400);assert.ok(x.state.has(state));
 }
});
test('untrusted company discovery does not expose extra names',async()=>{
 const x=fixture(),{out}=await begin(x,[A]);
 assert.equal(out.status,200);assert.match(out.body,/A &amp; Co/);
 assert.doesNotMatch(out.body,/Beta/);
});
test('invalid product and insecure origin are rejected at startup',()=>{
 const valid={applicationId:'field',origin,selectionStore:{save:async()=>{},consume:async()=>null},
  listOrganisations:async()=>[],resolveLocalIdentity:async()=>({}),establishSession:async()=>''};
 assert.throws(()=>createProductSelectionHttp({...valid,origin:'http://evil.test'}),TypeError);
 assert.throws(()=>createProductSelectionHttp({...valid,applicationId:'unknown'}),TypeError);
 assert.throws(()=>createProductSelectionHttp({...valid,afterLogin:'//evil.test'}),TypeError);
});
test('unrelated routes do not intercept product traffic',async()=>{
 const x=fixture(),out=res();
 assert.equal(await x.flow.handle({url:'/jobs',headers:{}},out),false);
 assert.equal(out.status,0);
});
