import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralSessionManager,CENTRAL_COOKIE,readSessionCookie,sessionCookie,clearSessionCookie} from '../src/central-session.mjs';
const COMPANY='00000000-0000-4000-8000-000000000001';
const OTHER='00000000-0000-4000-8000-000000000002';
const TOKENS=['A'.repeat(43),'B'.repeat(43),'C'.repeat(43)];
const request=cookie=>({headers:{cookie}});
function setup(){
  const records=new Map();
  let index=0,now=1_000_000;
  const store={
    async insert(row){if(records.has(row.digest))throw Error('duplicate');records.set(row.digest,row);},
    async find(hash){return records.get(hash)||null;},
    async delete(hash){records.delete(hash);}
  };
  const manager=createCentralSessionManager({store,clock:()=>now,random:()=>TOKENS[index++]});
  return {manager,store,records,setNow:v=>now=v};
}
test('issues a host-only opaque cookie; stores only its digest',async()=>{
  const {manager,records}=setup();
  const {cookie}=await manager.issue({identityId:'issuer|subject-1',companyId:COMPANY});
  assert.match(cookie,/^__Host-titan-central=/);
  assert.match(cookie,/; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800$/);
  assert.doesNotMatch(JSON.stringify([...records.values()]),/A{43}/);
  assert.deepEqual(await manager.resolve(request(cookie.split(';')[0])),{identityId:'issuer|subject-1',companyId:COMPANY});
});
test('absent, duplicate, malformed and oversized cookies fail closed',async()=>{
  const {manager}=setup();await manager.issue({identityId:'subject',companyId:COMPANY});
  for(const cookie of ['',`${CENTRAL_COOKIE}=bad`,`${CENTRAL_COOKIE}=${TOKENS[0]}; ${CENTRAL_COOKIE}=${TOKENS[0]}`,'a='.repeat(5000)]){
    assert.equal(await manager.resolve(request(cookie)),null);
  }
  assert.equal(readSessionCookie({headers:{cookie:'other=token'}}),null);
});
test('expired sessions are unusable',async()=>{
  const {manager,setNow}=setup();
  const {cookie}=await manager.issue({identityId:'subject',companyId:COMPANY});
  setNow(1_000_000+8*60*60*1000);
  assert.equal(await manager.resolve(request(cookie.split(';')[0])),null);
});
test('revoke makes session unusable and produces deletion cookie',async()=>{
  const {manager}=setup();const {cookie}=await manager.issue({identityId:'subject',companyId:COMPANY});
  assert.equal(await manager.revoke(request(cookie.split(';')[0])),clearSessionCookie());
  assert.equal(await manager.resolve(request(cookie.split(';')[0])),null);
});
test('rotate changes company with a new token and invalidates old token',async()=>{
  const {manager}=setup();const old=await manager.issue({identityId:'subject',companyId:COMPANY});
  const replacement=await manager.rotate(request(old.cookie.split(';')[0]),{identityId:'subject',companyId:OTHER});
  assert.notEqual(replacement.cookie,old.cookie);
  assert.equal(await manager.resolve(request(old.cookie.split(';')[0])),null);
  assert.deepEqual(await manager.resolve(request(replacement.cookie.split(';')[0])),{identityId:'subject',companyId:OTHER});
});
test('rotation rejects foreign identity and unauthenticated requests',async()=>{
  const {manager}=setup();const old=await manager.issue({identityId:'subject',companyId:COMPANY});
  await assert.rejects(manager.rotate(request(old.cookie.split(';')[0]),{identityId:'foreign',companyId:OTHER}),/not authorised/);
  await assert.rejects(manager.rotate(request(''),{identityId:'subject',companyId:OTHER}),/session required/);
  assert.deepEqual(await manager.resolve(request(old.cookie.split(';')[0])),{identityId:'subject',companyId:COMPANY});
});
test('session cookie rejects malformed values and excessively long expiry',()=>{
  assert.throws(()=>sessionCookie('invalid'),TypeError);
  assert.throws(()=>sessionCookie(TOKENS[0],9999999),TypeError);
});
test('session issuance requires an authenticated identity and canonical company',async()=>{
  const {manager}=setup();
  await assert.rejects(manager.issue({identityId:'',companyId:COMPANY}),TypeError);
  await assert.rejects(manager.issue({identityId:'subject',companyId:'attacker'}),TypeError);
});
test('store failures fail closed instead of manufacturing access',async()=>{
  const store={insert:async()=>{throw Error('db offline')},find:async()=>{throw Error('db offline')},delete:async()=>{}};
  const manager=createCentralSessionManager({store,random:()=>TOKENS[0]});
  await assert.rejects(manager.issue({identityId:'subject',companyId:COMPANY}),/db offline/);
  await assert.rejects(manager.resolve(request(`${CENTRAL_COOKIE}=${TOKENS[0]}`)),/db offline/);
});
