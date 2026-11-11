import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralLogoutHandler} from '../src/central-logout.mjs';
import {clearSessionCookie} from '../src/central-session.mjs';

const ORIGIN='https://central.example';
const response=()=>({status:0,headers:{},body:'',
  writeHead(status,headers){this.status=status;this.headers=headers},
  end(body=''){this.body=body}});
function fixture(revoke=async()=>clearSessionCookie()){
  const called=[];
  const handler=createCentralLogoutHandler({origin:ORIGIN,sessions:{
    async revoke(req){called.push(req);return revoke(req)}
  }});
  const req={method:'POST',url:'/auth/central/logout',headers:{origin:ORIGIN,'content-length':'0','sec-fetch-site':'same-origin'}};
  return {handler,called,req};
}
test('POST from trusted origin revokes before issuing deletion cookie and redirect',async()=>{
  const f=fixture(),res=response();
  assert.equal(await f.handler(f.req,res),true);
  assert.equal(f.called.length,1);
  assert.equal(res.status,303);
  assert.equal(res.headers.location,'/auth/central/start');
  assert.equal(res.headers['set-cookie'],clearSessionCookie());
  assert.match(res.headers['set-cookie'],/Secure; HttpOnly; SameSite=Lax; Max-Age=0/);
  assert.equal(res.headers['cache-control'],'no-store, private');
});
test('GET logout and unknown paths do not revoke a session',async()=>{
  const f=fixture(),res=response();
  assert.equal(await f.handler({...f.req,method:'GET'},res),true);
  assert.equal(res.status,405);
  assert.equal(await f.handler({...f.req,url:'/central'},response()),false);
  assert.equal(f.called.length,0);
});
test('cross-site, missing origin, query redirects and bodies fail before revocation',async()=>{
  for(const mutation of [
    {headers:{origin:'https://attacker.example'}},
    {headers:{}},
    {url:'/auth/central/logout?next=https://attacker.example'},
    {headers:{origin:ORIGIN,'sec-fetch-site':'cross-site'}},
    {headers:{origin:ORIGIN,'content-length':'3'}},
    {headers:{origin:ORIGIN,'transfer-encoding':'chunked'}}
  ]){
    const f=fixture(),res=response();
    await f.handler({...f.req,...mutation},res);
    assert.equal(res.status,403);
    assert.equal(f.called.length,0);
    assert.equal(res.headers.location,undefined);
  }
});
test('database failure is not presented as successful logout',async()=>{
  const f=fixture(async()=>{throw Error('database offline')}),res=response();
  await f.handler(f.req,res);
  assert.equal(res.status,503);
  assert.equal(res.headers['set-cookie'],undefined);
  assert.doesNotMatch(res.body,/database offline/);
});
test('untrusted or insecure server origins are rejected at construction',()=>{
  for(const origin of ['http://central.example','https://central.example/path','https://central.example?x=1','https://u:p@central.example']){
    assert.throws(()=>createCentralLogoutHandler({origin,sessions:{revoke:async()=>clearSessionCookie()}}),TypeError);
  }
});
