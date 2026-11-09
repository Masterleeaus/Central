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
const cb=`titan_desk_oidc_binding=${token}`;
test('malformed request URL gets 400 instead of throwing',async()=>{const x=setup();const {handled,res}=await call(x.adapter,'http://[::1');assert.equal(handled,true);assert.equal(res.status,400);assert.match(res.body,/invalid_url/);});
test('an exception inside the route returns 500 and does not escape',async()=>{const x=setup();const req={get method(){throw Error('boom')},url:'/auth/titan/desk/start',headers:{}};const res=makeRes();const handled=await x.adapter(req,res);assert.equal(handled,true);assert.equal(res.status,500);});
test('non-localhost http authorization URL is refused, localhost only with the dev flag',async()=>{
 const local={begin:async()=>({authorizationUrl:'http://localhost:9000/oidc/auth?state=s'}),complete:async()=>({subject:'uid',issuer:'https://id.example'})};
 const strict=setup({oidcLogin:local});assert.equal((await call(strict.adapter,'/auth/titan/desk/start')).res.status,503);
 const dev=setup({oidcLogin:local,allowInsecureLocalhost:true});assert.equal((await call(dev.adapter,'/auth/titan/desk/start')).res.status,303);
});
test('callback is rate-limited per client IP before the token exchange',async()=>{
 const x=setup({rateLimits:{ip:{limit:1,windowMs:60_000},subject:{limit:10,windowMs:60_000}}});
 const first=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 const second=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 assert.equal(first.res.status,303);assert.equal(second.res.status,429);assert.ok(Number(second.res.headers['retry-after'])>=1);
 assert.equal(x.counts().complete,1);
});
test('callback is rate-limited per verified subject',async()=>{
 const x=setup({rateLimits:{ip:{limit:100,windowMs:60_000},subject:{limit:1,windowMs:60_000}}});
 const first=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 const second=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 assert.equal(first.res.status,303);assert.equal(second.res.status,429);assert.equal(x.counts().establish,1);
});
test('login outcomes are logged as structured fields without tokens, codes or subjects',async()=>{
 const events=[];const logger=(event,fields)=>events.push({event,fields});
 const ok=setup({logger,oidcLogin:{begin:async()=>({authorizationUrl:'https://id.example/oidc/auth?state=s'}),complete:async()=>({subject:'subject-secret-7',issuer:'https://id.example'})}});
 await call(ok.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 const bad=setup({logger,oidcLogin:{begin:async()=>({authorizationUrl:'https://id.example/oidc/auth?state=s'}),complete:async()=>{throw Error('exchange failed code=secret-code-999')}}});
 await call(bad.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 const denied=setup({logger,resolveLocalIdentity:async()=>({authorised:false})});
 await call(denied.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 assert.deepEqual(events.map(e=>e.event),['login_succeeded','login_failed','login_denied']);
 assert.equal(events[0].fields.application,'desk');assert.equal(events[1].fields.reason,'unexpected_error');assert.equal(events[2].fields.reason,'account_not_authorised');
 const dump=JSON.stringify(events);
 assert.ok(!dump.includes('subject-secret-7'),'subject must not be logged');
 assert.ok(!dump.includes('secret-code-999'),'error text must not be logged');
 assert.ok(!dump.includes(token),'browser binding must not be logged');
});

test('simultaneous callbacks cannot cause multiple token exchanges under concurrency cap',async()=>{
 let begin,release;
 const entered=new Promise(resolve=>begin=resolve);
 const pending=new Promise(resolve=>release=resolve);
 let exchanges=0;
 const x=setup({concurrencyLimits:{perKey:1,globalLimit:1},
   oidcLogin:{begin:async()=>({authorizationUrl:'https://id.example/oidc/auth?state=s'}),
    complete:async()=>{exchanges++;begin();await pending;return {subject:'uid',issuer:'https://id.example'};}}});
 const first=call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 await entered;
 const denied=await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb});
 assert.equal(denied.res.status,429);
 assert.equal(exchanges,1);
 release();
 assert.equal((await first).res.status,303);
 assert.equal((await call(x.adapter,'/auth/titan/desk/callback?state=s&code=c',{cookie:cb})).res.status,303);
});
test('OIDC start route consumes IP rate budget before contacting issuer',async()=>{
 let begins=0;
 const x=setup({rateLimits:{ip:{limit:1,windowMs:60000},subject:{limit:20,windowMs:60000}},
   oidcLogin:{begin:async()=>{begins++;return {authorizationUrl:'https://id.example/oidc/auth?state=s'}},
    complete:async()=>({subject:'uid',issuer:'https://id.example'})}});
 assert.equal((await call(x.adapter,'/auth/titan/desk/start')).res.status,303);
 assert.equal((await call(x.adapter,'/auth/titan/desk/start')).res.status,429);
 assert.equal(begins,1);
});