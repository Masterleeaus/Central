import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralOidcStateStore} from '../src/central-oidc-state-pg.mjs';
const BASE=1000000;
const state='S'.repeat(43),nonce='N'.repeat(43),verifier='V'.repeat(43),bindingHash='H'.repeat(43);
const sealer={seal:(value,aad)=>'sealed:'+value+':'+aad,open:(value,aad)=>{
  const prefix='sealed:';
  if(!value.startsWith(prefix)||!value.endsWith(':'+aad))throw Error('corrupt');
  return value.slice(prefix.length,-aad.length-1);
}};
function fake(rows=[]){
  const calls=[];let released=0;
  const pool={async connect(){return {
    async query(sql,args){calls.push([sql,args]);if(sql.startsWith('DELETE FROM'))return {rows};return {rows:[]}},
    release(){released++}
  }}};
  return {pool,calls,get released(){return released}};
}
test('Central OIDC login state saves sealed secrets within a dedicated role',async()=>{
  const ctx=fake();
  const store=createCentralOidcStateStore({pool:ctx.pool,sealer,clock:()=>BASE});
  await store.save(state,{nonce,verifier,bindingHash,expiresAt:BASE+300000});
  assert.deepEqual(ctx.calls.slice(0,3).map(x=>x[0]),['BEGIN','SET LOCAL ROLE titan_central_oidc',"SET LOCAL statement_timeout = '5000ms'"]);
  const insert=ctx.calls.find(([sql])=>sql.startsWith('INSERT INTO'));
  assert.equal(insert[1][0],'central');
  assert.ok(insert[1][2].startsWith('sealed:'));
  assert.ok(!insert[1][2].includes('undefined'));
  assert.equal(ctx.calls.at(-1)[0],'COMMIT');
  assert.equal(ctx.released,1);
});
test('OIDC state is consumed once with bound namespace and digest',async()=>{
  const ctx=fake();
  const store=createCentralOidcStateStore({pool:ctx.pool,sealer,clock:()=>BASE});
  await store.save(state,{nonce,verifier,bindingHash,expiresAt:BASE+300000});
  const insert=ctx.calls.find(([sql])=>sql.startsWith('INSERT INTO'));
  const row={nonce:insert[1][2],code_verifier:insert[1][3],binding_hash:bindingHash,expires_at:new Date(BASE+300000)};
  const consumed=fake([row]);
  const reader=createCentralOidcStateStore({pool:consumed.pool,sealer,clock:()=>BASE});
  assert.deepEqual(await reader.consume(state),{nonce,verifier,bindingHash,expiresAt:BASE+300000});
  const deletion=consumed.calls.find(([sql])=>sql.startsWith('DELETE FROM'));
  assert.equal(deletion[1][0],'central');
  assert.equal(deletion[1][1],insert[1][1]);
});
test('empty state returns no session without a DB query',async()=>{
  const ctx=fake();
  const store=createCentralOidcStateStore({pool:ctx.pool,sealer,clock:()=>BASE});
  assert.equal(await store.consume('bad'),null);
  assert.equal(ctx.calls.length,0);
});
test('role or database failure rolls back before releasing pooled connection',async()=>{
  const calls=[];let released=false;
  const pool={async connect(){return {
    async query(sql){calls.push(sql);if(sql.startsWith('INSERT'))throw Error('offline');return {rows:[]}},
    release(){released=true}
  }}};
  const store=createCentralOidcStateStore({pool,sealer,clock:()=>BASE});
  await assert.rejects(store.save(state,{nonce,verifier,bindingHash,expiresAt:BASE+300000}),/offline/);
  assert.ok(calls.includes('ROLLBACK'));assert.equal(released,true);
});
