import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createCentralHandler} from '../src/app.mjs';

const ORG='00000000-0000-4000-8000-000000000001';
const AUDIENCES={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const APPS=['field','desk','academy'];

async function check(applicationId, tokenAudience) {
  const pool={async connect(){return {async query(){return {rows:[]}},release(){}}}};
  const principal={logtoSubject:'user1',issuer:'https://issuer.example',audience:tokenAudience,verifiedAt:new Date().toISOString()};
  const server=createServer(createCentralHandler({pool,verifyToken:async()=>principal,issuer:'https://issuer.example',audiences:AUDIENCES}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/access/check?organisation_id=${ORG}&application=${applicationId}&action=read:jobs`,{headers:{authorization:'Bearer abc.def.ghi'}});
    return {status:r.status,body:await r.json()};
  } finally {server.close();await once(server,'close');}
}

for (const tokenApp of APPS) {
  for (const targetApp of APPS) {
    if (tokenApp===targetApp) continue;
    test(`token issued for ${tokenApp} is rejected for ${targetApp}`, async()=>{
      const r=await check(targetApp, AUDIENCES[tokenApp]);
      assert.equal(r.status,403);
      assert.equal(r.body.reason,'untrusted_audience');
    });
  }
}

for (const app of APPS) {
  test(`token issued for ${app} passes the audience gate for ${app}`, async()=>{
    const r=await check(app, AUDIENCES[app]);
    assert.notEqual(r.body.reason,'untrusted_audience');
  });
}

test('a token with the single legacy shared audience is rejected for every app', async()=>{
  const r=await check('desk','control');
  assert.equal(r.body.reason,'untrusted_audience');
});

test('handler refuses to start without per-application audiences', ()=>{
  const pool={connect:async()=>({})};
  const verifyToken=async()=>({});
  assert.throws(()=>createCentralHandler({pool,verifyToken,issuer:'https://issuer.example'}),/per-application audiences required/);
  assert.throws(()=>createCentralHandler({pool,verifyToken,issuer:'https://issuer.example',audiences:{field:'aud-field',desk:'aud-field',academy:'aud-academy'}}),/per-application audiences required/);
  assert.throws(()=>createCentralHandler({pool,verifyToken,issuer:'https://issuer.example',audiences:{field:'aud-field',desk:'aud-desk'}}),/per-application audiences required/);
  assert.throws(()=>createCentralHandler({pool,verifyToken,issuer:'https://issuer.example',audiences:{field:'aud-field',desk:'',academy:'aud-academy'}}),/per-application audiences required/);
});
