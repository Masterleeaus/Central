import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductMultiCompanyOidcService} from '../src/product-oidc-selection-service.mjs';

const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const C='00000000-0000-4000-8000-000000000003';
const binding='b'.repeat(43),issuer='https://id.example';
const response=()=>({status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(value=''){this.body=value}});
const callback={method:'GET',url:'/auth/titan/field/callback?state=valid&code=valid',
 headers:{cookie:'titan_field_oidc_binding='+binding}};
function request(state,organisationId,{origin='https://field.example',cookie='titan_field_oidc_binding='+binding}={}){
 return {method:'POST',url:'/auth/titan/field/select',
  headers:{cookie,origin,'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded'},
  async *[Symbol.asyncIterator](){yield Buffer.from('state='+state+'&organisation_id='+organisationId)}};
}
function setup({eligible=[A,B],revoked=[],wrongAccount=false,changeAfterFirstCheck=false}={}){
 const saved=new Map(),events=[],issued=[];
 const service=createProductMultiCompanyOidcService({
  applicationId:'field',issuer,audience:'field-client',origin:'https://field.example',
  oidcLogin:{begin:async()=>({authorizationUrl:'https://id.example/authorize'}),
   complete:async()=>({issuer,subject:'user-123'})},
  findOrganisationIds:async()=>{events.push('discovery');return eligible},
  authorise:async args=>{
   events.push('access:'+args.organisationId);
   const prior=events.filter(x=>x==='access:'+args.organisationId).length;
   return {allowed:!revoked.includes(args.organisationId) && !(changeAfterFirstCheck&&prior>=2),
    applicationId:'field',organisationId:args.organisationId,
    localUserId:'user-'+args.organisationId,localAccountId:'account-'+args.organisationId};
  },
  localAccountActive:async args=>{events.push('local-account:'+args.organisationId);return !wrongAccount},
  listOrganisations:async()=>eligible.map(id=>({id,name:id===A?'Alpha & Co':'Beta'})),
  establishSession:async args=>{events.push('rotate:'+args.organisationId);issued.push(args);
   return 'field_sid='+ 'Z'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Lax'},
  selectionStore:{save:async(k,v)=>saved.set(k,v),consume:async k=>{const value=saved.get(k);saved.delete(k);return value}},
  afterLogin:'/jobs'
 });
 return {service,saved,events,issued};
}
async function startSelection(x){
 const res=response();
 await x.service.handler(callback,res);
 assert.equal(res.status,200);
 const state=/name="state" value="([A-Za-z0-9_-]{43})"/.exec(res.body)?.[1];
 assert.ok(state);return state;
}
test('multi-company OIDC callback selects exactly one app-owned local account',async()=>{
 const x=setup(),state=await startSelection(x);
 assert.match([...x.saved.values()][0].bindingHash,/^[0-9a-f]{64}$/);
 const out=response();await x.service.handler(request(state,B),out);
 assert.equal(out.status,303);
 assert.equal(out.headers.location,'/jobs');
 assert.equal(x.issued.length,1);
 assert.equal(x.issued[0].organisationId,B);
 assert.equal(x.issued[0].oidcSubject,'user-123');
 assert.equal(x.events.filter(v=>v==='access:'+B).length,2);
 assert.equal(x.events.filter(v=>v==='rotate:'+A).length,0);
});
test('foreign selection and replay are rejected without session rotation',async()=>{
 const x=setup(),state=await startSelection(x);
 const rejected=response();
 await x.service.handler(request(state,C),rejected);
 assert.equal(rejected.status,403);
 const replay=response();await x.service.handler(request(state,A),replay);
 assert.equal(replay.status,403);assert.equal(x.issued.length,0);
});
test('membership revocation between listing and selection denies product session',async()=>{
 const x=setup({revoked:[B]}),state=await startSelection(x);
 const denied=response();await x.service.handler(request(state,B),denied);
 assert.equal(denied.status,403);assert.equal(x.issued.length,0);
});
test('second authority recheck can veto a previously authorised selection',async()=>{
 const x=setup({changeAfterFirstCheck:true}),state=await startSelection(x);
 const denied=response();await x.service.handler(request(state,A),denied);
 assert.equal(denied.status,503);
 assert.equal(x.issued.length,0);
});
test('revoked product-local account link denies selection after membership check',async()=>{
 const x=setup({wrongAccount:true}),state=await startSelection(x);
 const denied=response();await x.service.handler(request(state,A),denied);
 assert.equal(denied.status,403);assert.equal(x.issued.length,0);
});
test('trusted company list excludes unverified company and does not leak names',async()=>{
 const x=setup({eligible:[A]}),state=await startSelection(x);
 assert.equal(x.saved.size,1);
 const out=response();await x.service.handler(request(state,B),out);
 assert.equal(out.status,403);assert.equal(x.issued.length,0);
});
test('cross-origin POST does not consume state; wrong browser binding burns it safely',async()=>{
 const x=setup(),state=await startSelection(x);
 const cross=response();await x.service.handler(request(state,A,{origin:'https://other.example'}),cross);
 assert.equal(cross.status,403);
 assert.equal(x.saved.has(state),true);
 const valid=response();await x.service.handler(request(state,A),valid);
 assert.equal(valid.status,303);assert.equal(x.issued.length,1);
 const newer=await startSelection(x);
 const wrong=response();await x.service.handler(request(newer,A,{cookie:'titan_field_oidc_binding='+'q'.repeat(43)}),wrong);
 assert.equal(wrong.status,403);
 const replay=response();await x.service.handler(request(newer,A),replay);
 assert.equal(replay.status,403,'binding mismatch deliberately consumes the one-use state');
 assert.equal(x.issued.length,1);
});
test('empty authority dependencies fail at initialization',()=>{
 assert.throws(()=>createProductMultiCompanyOidcService({applicationId:'field'}),TypeError);
});
