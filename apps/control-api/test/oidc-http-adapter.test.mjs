import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOidcHttpAdapter} from '../src/oidc-http-adapter.mjs';
const makeRes=()=>({status:null,headers:null,body:'',writeHead(s,h){this.status=s;this.headers=h},end(s=''){this.body=s}});
const token='x'.repeat(43);
function setup(overrides={}) {
 let begin=0, complete=0, resolve=0, establish=0;
 const adapter=createOidcHttpAdapter({applicationId:'desk',afterLogin:'/workspace',oidcLogin:{async begin(){begin++;return {authorizationUrl:'https://id.example/oidc/auth?state=s'}},async complete(){complete++;return {subject:'uid',issuer:'https://id.example'}}},async resolveLocalIdentity(){resolve++;return {authorised:true,localUserId:'local-42',localAccountId:'account-42',organisationId:'org-42'}},async establishSession(){establish++;return 'desk_sid=validtoken; Path=/; Secure; HttpOnly; SameSite=Lax'},...overrides});
 return {adapter,counts:()=>({begin,complete,resolve,establish})};
}
const call=async (adapter,url,headers={},method='GET')=>{const res=makeRes();const handled=await adapter({url,method,headers},res);return {handled,res};};
test('ignores unrelated paths',async()=>{const x=setup();assert.equal((await call(x.adapter,'/other')).handled,false)});
test('GET only',async()=>{const x=setup();assert.equal((await call(x.adapter,'/auth/titan/desk/start',{},'POST')).res.status,405)});
test('start refuses arbitrary next redirect',async()=>{const x=setup();assert.equal((await call(x.adapter,'/auth/titan/desk/start?next=https://evil.test')).res.status,400)});
test('start sets host-only secure browser binding cookie',async()=>{const x=setup();const {res}=await call(x.adapter,'/auth/titan/desk/start');assert.equal(res.status,303);assert.equal(res.headers.location,'https://id.example/oidc/auth?state=s');assert.match(res.headers['set-cookie'],/Secure; HttpOnly; SameSite=Lax/);assert.ok(!res.headers['set-cookie'].includes('Domain='));assert.equal(x.counts().begin,1)});
test('callback without bound browser rejected before completing',async()=>{const x=setup();const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c');assert.equal(res.status,400);assert.equal(x.counts().complete,0)});
test('callback rejects duplicate query params',async()=>{const x=setup();const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&state=t&code=c',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,400)});
test('callback rejects unexpected query params',async()=>{const x=setup();const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c&user=owner',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,400)});
test('IdP errors fail closed',async()=>{const x=setup();const {res}=await call(x.adapter,'/auth/titan/desk/callback?error=access_denied',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,401);assert.equal(x.counts().complete,0)});
test('successful callback resolves local identity and rotates session',async()=>{const x=setup();const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,303);assert.equal(res.headers.location,'/workspace');assert.equal(res.headers['set-cookie'].length,2);assert.deepEqual(x.counts(),{begin:0,complete:1,resolve:1,establish:1});});
test('unlinked users cannot obtain local sessions',async()=>{let called=false;const x=setup({resolveLocalIdentity:async()=>({authorised:false}),establishSession:async()=>{called=true;return ''}});const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,403);assert.equal(called,false)});
test('session adapter cannot return insecure cookie',async()=>{const x=setup({establishSession:async()=> 'sid=123; Path=/'});const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,401)});
test('session adapter fails closed on exception',async()=>{const x=setup({establishSession:async()=>{throw Error('store down')}});const {res}=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:`titan_desk_oidc_binding=${token}`});assert.equal(res.status,401)});
test('invalid app registration rejected',()=>assert.throws(()=>createOidcHttpAdapter({applicationId:'admin'}),TypeError));
test('untrusted postlogin external URL rejected',()=>assert.throws(()=>createOidcHttpAdapter({applicationId:'desk',afterLogin:'//evil.test',oidcLogin:{begin(){},complete(){}},resolveLocalIdentity(){},establishSession(){}}),TypeError));
