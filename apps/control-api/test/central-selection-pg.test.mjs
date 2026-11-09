import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresCompanySelectionStore} from '../src/central-selection-pg.mjs';
const STATE='S'.repeat(43),BINDING='a'.repeat(64);
const COMPANY='00000000-0000-4000-8000-000000000001';
const now=1000000;
const sealer={seal:(value,aad)=>'seal:'+aad+':'+value,open:(value,aad)=>{
  const prefix='seal:'+aad+':';
  if(!value.startsWith(prefix))throw Error('wrong AAD');
  return value.slice(prefix.length);
}};
function fixture(rows=[]){
  const calls=[],records=[];
  const pool={async connect(){return {
    async query(sql,args){
      calls.push({sql,args});
      if(sql.startsWith('INSERT INTO')){records.push(args);return {rows:[{state_digest:args[0]}]};}
      if(sql.startsWith('DELETE FROM')&&sql.includes('RETURNING binding_hash'))return {rows};
      if(sql.startsWith('DELETE FROM'))return {rows:[]};
      return {rows:[]};
    },release(){calls.push({sql:'RELEASE'})}
  }}};
  return {store:createPostgresCompanySelectionStore({pool,sealer,clock:()=>now}),calls,records};
}
const value={issuer:'https://issuer.example',subject:'verified-subject',bindingHash:BINDING,organisationIds:[COMPANY],expiresAt:now+300000};
test('stores only digest, binding hash and AES-GCM sealed identity/allowed companies',async()=>{
  const ctx=fixture();await ctx.store.save(STATE,value);
  const args=ctx.records[0];
  assert.match(args[0],/^[0-9a-f]{64}$/);
  assert.notEqual(args[0],STATE);
  assert.equal(args[1],BINDING);
  assert.ok(args.slice(2,5).every(v=>v.startsWith('seal:central_company_selection|')));
  assert.equal(ctx.calls[1].sql,'SET LOCAL ROLE titan_central_selection');
  assert.equal(ctx.calls.at(-2).sql,'COMMIT');
  assert.equal(ctx.calls.at(-1).sql,'RELEASE');
});
test('consumes decrypted one-use state by hashed key with bounded expiry',async()=>{
  const save=fixture();await save.store.save(STATE,value);
  const [digest,bindingHash,sealedIssuer,sealedSubject,sealedCompanyIds]=save.records[0];
  const ctx=fixture([{binding_hash:bindingHash,sealed_issuer:sealedIssuer,sealed_subject:sealedSubject,sealed_company_ids:sealedCompanyIds,expires_at:new Date(value.expiresAt)}]);
  assert.deepEqual(await ctx.store.consume(STATE),value);
  assert.equal(ctx.calls.find(c=>c.sql.startsWith('DELETE FROM')).args[0],digest);
});
test('expired or missing selections return null',async()=>{
  assert.equal(await fixture().store.consume(STATE),null);
  const ctx=fixture();
  assert.equal(await ctx.store.consume('bad'),null);
  assert.equal(ctx.calls.length,0);
});
test('tampered encrypted company list fails closed after state consumption',async()=>{
  const ctx=fixture([{binding_hash:BINDING,sealed_issuer:'tampered',sealed_subject:'tampered',sealed_company_ids:'tampered',expires_at:new Date(now+300000)}]);
  assert.equal(await ctx.store.consume(STATE),null);
  assert.equal(ctx.calls.at(-2).sql,'COMMIT');
});
test('refuses duplicate or malformed choices before storing',async()=>{
  const ctx=fixture();
  await assert.rejects(ctx.store.save(STATE,{...value,organisationIds:[COMPANY,COMPANY]}),TypeError);
  await assert.rejects(ctx.store.save(STATE,{...value,organisationIds:['invalid']}),TypeError);
  await assert.rejects(ctx.store.save('not random',value),TypeError);
  assert.equal(ctx.calls.length,0);
});
test('bounded pruning uses SKIP LOCKED and a parameterised batch size',async()=>{
  const ctx=fixture();
  assert.equal(await ctx.store.prune({limit:25}),0);
  assert.ok(ctx.calls.some(c=>c.sql.includes('SKIP LOCKED')&&c.args[0]===25));
  await assert.rejects(ctx.store.prune({limit:5001}),TypeError);
});


test('persisted selection refuses untrusted OIDC issuer and invalid subject before SQL',async()=>{
 const ctx=fixture();
 for(const issuer of ['http://issuer.example','https://issuer.example/?query=1','https://attacker@issuer.example/']){
  await assert.rejects(ctx.store.save(STATE,{...value,issuer}),TypeError);
 }
 for(const subject of ['bad\nsubject','','x'.repeat(257)]){
  await assert.rejects(ctx.store.save(STATE,{...value,subject}),TypeError);
 }
 assert.equal(ctx.calls.length,0);
});
test('decrypted selection does not trust invalid issuer or subject even with otherwise valid ciphertext',async()=>{
 const saved=fixture();await saved.store.save(STATE,value);
 const [,bindingHash,,sealedSubject,sealedIds]=saved.records[0];
 const hash=(await import('node:crypto')).createHash('sha256').update(STATE).digest('hex');
 const wrongIssuer='seal:central_company_selection|'+hash+'|issuer:http://attacker.example/';
 const ctx=fixture([{binding_hash:bindingHash,sealed_issuer:wrongIssuer,
  sealed_subject:sealedSubject,sealed_company_ids:sealedIds,expires_at:new Date(value.expiresAt)}]);
 assert.equal(await ctx.store.consume(STATE),null);
});
