import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralLauncherHandler,renderCentralLauncher,validateLauncherDestinations} from '../src/central-launcher.mjs';
const companyId='00000000-0000-4000-8000-000000000001';
const destinations={sorted:'https://sorted.example/',supercharged:'https://supercharged.example/',lms:'https://lms.example/'};
const products=[{id:'sorted',status:'allowed'},{id:'supercharged',status:'denied'},{id:'lms',status:'unavailable'}];
const data={authorised:true,company:{id:companyId,name:'Example & Co'},products};
function fakeRes(){return {status:null,headers:null,body:null,writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}}}
const make = (overrides={}) => createCentralLauncherHandler({resolveSession:async()=>({identityId:'user_1',companyId}),readProducts:async()=>data,destinations,...overrides});
test('renders product decisions from a trusted company scope, not client query parameters',async()=>{
  const res=fakeRes();let scope;
  const handler=make({readProducts:async args=>{scope=args;return data}});
  assert.equal(await handler({url:'/central?company_id=evil',method:'GET'},res),true);
  assert.equal(res.status,200);assert.deepEqual(scope,{identityId:'user_1',companyId});
  assert.match(res.body,/Example &amp; Co/);assert.match(res.body,/Open Sorted/);
  assert.doesNotMatch(res.body,/Open Supercharged|Open LMS/);
  assert.match(res.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal(res.headers['cache-control'],'no-store, private');
});
test('unknown paths are not handled',async()=>{const res=fakeRes();assert.equal(await make()({url:'/v1/access/check',method:'GET'},res),false);assert.equal(res.status,null)});
test('missing session fails closed and never reads product access',async()=>{
  let n=0;const res=fakeRes();await make({resolveSession:async()=>null,readProducts:async()=>{n++;return data}})({url:'/central',method:'GET'},res);
  assert.equal(res.status,401);assert.equal(n,0);
});
test('a mismatched company or revoked membership fails closed',async()=>{
  for(const record of [{...data,authorised:false},{...data,company:{...data.company,id:'00000000-0000-4000-8000-000000000002'}}]){
    const res=fakeRes();await make({readProducts:async()=>record})({url:'/central',method:'GET'},res);assert.equal(res.status,403);
  }
});
test('malformed decision fails unavailable, never grants',async()=>{
  const res=fakeRes();await make({readProducts:async()=>({...data,products:[...products,{id:'sorted',status:'allowed'}]})})({url:'/central',method:'GET'},res);
  assert.equal(res.status,503);
});
test('errors do not leak secrets or exception internals',async()=>{
  const res=fakeRes();await make({readProducts:async()=>{throw Error('database secret')}})({url:'/central',method:'GET'},res);
  assert.equal(res.status,503);assert.equal(res.body,'Launcher unavailable');
});
test('rejects unsafe, duplicate, and attacker-controlled destinations',()=>{
  for(const bad of ['http://sorted.example/','https://sorted.example/evil','https://evil@sorted.example/','https://sorted.example/?redirect=bad','https://sorted.example/#fragment']){
    assert.throws(()=>validateLauncherDestinations({sorted:bad}),TypeError);
  }
  assert.throws(()=>validateLauncherDestinations({sorted:'https://same.example/',lms:'https://same.example/'}),TypeError);
});
test('escapes untrusted company names',()=>{
  const html=renderCentralLauncher({company:{id:companyId,name:'<img src=x onerror=alert(1)>'},products,destinations});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('only GET is supported',async()=>{
  const res=fakeRes();await make()({url:'/central',method:'POST'},res);assert.equal(res.status,405);
});
