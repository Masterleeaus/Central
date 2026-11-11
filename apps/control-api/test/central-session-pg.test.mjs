import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresCentralSessionStore} from '../src/central-session-pg.mjs';

const ID='00000000-0000-4000-8000-000000000001';
const DIGEST='f'.repeat(64);
function setup({fail=false,rows=[]}={}){
  const calls=[];
  let released=0;
  const client={
    async query(sql,values){
      calls.push({sql,values});
      if(fail && sql.includes('titan.central_browser_sessions'))throw Error('connection lost');
      return {rows:(sql.includes('titan.central_browser_sessions')||sql.includes('titan.central_issue_browser_session'))?rows:[]};
    },
    release(){released++;}
  };
  const store=createPostgresCentralSessionStore({pool:{connect:async()=>client}});
  return {store,calls,get released(){return released}};
}
test('issuance calls locked authority function with bound digest, subject, company and expiry',async()=>{
  const ctx=setup({rows:[{token_digest:DIGEST}]});
  await ctx.store.insert({digest:DIGEST,identityId:'issuer|sub',companyId:ID,expiresAt:Date.now()+60000});
  assert.deepEqual(ctx.calls.map(x=>x.sql).slice(0,3),['BEGIN','SET LOCAL ROLE titan_central_sessions',"SET LOCAL statement_timeout = '5000ms'"]);
  const insert=ctx.calls.find(x=>x.sql.includes('central_issue_browser_session'));
  assert.deepEqual(insert.values.slice(0,3),[DIGEST,'issuer|sub',ID]);
  assert.equal(ctx.calls.at(-1).sql,'COMMIT');
  assert.equal(ctx.released,1);
});
test('find maps PostgreSQL rows to session manager record',async()=>{
  const ctx=setup({rows:[{logto_subject:'issuer|sub',organisation_id:ID,expires_at:new Date('2027-01-01T00:00:00Z')}]});
  const record=await ctx.store.find(DIGEST);
  assert.deepEqual(record,{identityId:'issuer|sub',companyId:ID,expiresAt:Date.parse('2027-01-01T00:00:00Z')});
  assert.deepEqual(ctx.calls.find(x=>x.sql.startsWith('SELECT logto_subject')).values,[DIGEST]);
});
test('missing records return null, deletion reports whether it consumed a row',async()=>{
  const ctx=setup();
  assert.equal(await ctx.store.find(DIGEST),null);
  assert.equal(await ctx.store.delete(DIGEST),false);
});
test('delete atomically consumes a stored row and uses one bound digest',async()=>{
  const ctx=setup({rows:[{token_digest:DIGEST}]});
  assert.equal(await ctx.store.delete(DIGEST),true);
  assert.deepEqual(ctx.calls.find(x=>x.sql.startsWith('DELETE FROM')).values,[DIGEST]);
});
test('all SQL failures roll back and release connection',async()=>{
  const ctx=setup({fail:true});
  await assert.rejects(ctx.store.find(DIGEST),/connection lost/);
  assert.ok(ctx.calls.some(x=>x.sql==='ROLLBACK'));
  assert.equal(ctx.released,1);
});
test('rejects invalid digests, tenant IDs and malformed expiry before SQL',async()=>{
  const ctx=setup();
  await assert.rejects(ctx.store.insert({digest:'bad',identityId:'subject',companyId:ID,expiresAt:Date.now()+1000}),TypeError);
  await assert.rejects(ctx.store.insert({digest:DIGEST,identityId:'subject',companyId:'not-a-tenant',expiresAt:Date.now()+1000}),TypeError);
  await assert.rejects(ctx.store.find('invalid'),TypeError);
  await assert.rejects(ctx.store.prune({limit:99999}),TypeError);
  assert.equal(ctx.calls.length,0);
});
test('prune uses bounded parameterised, locked batch and returns count',async()=>{
  const ctx=setup({rows:[{token_digest:DIGEST}]});
  assert.equal(await ctx.store.prune({limit:25}),1);
  const sql=ctx.calls.find(x=>x.sql.includes('SKIP LOCKED'));
  assert.ok(sql); assert.deepEqual(sql.values,[25]);
});


test('session creation verifies returned digest before reporting success',async()=>{
 const ctx=setup({rows:[{token_digest:'a'.repeat(64)}]});
 await assert.rejects(ctx.store.insert({digest:DIGEST,identityId:'issuer|sub',
  companyId:ID,expiresAt:Date.now()+60000}),/not confirmed/);
 assert.ok(ctx.calls.some(x=>x.sql==='ROLLBACK'));
});
test('malformed session rows fail closed even when PostgreSQL returns them',async()=>{
 for(const row of [
  {logto_subject:'invalid\nsubject',organisation_id:ID,expires_at:new Date('2027-01-01')},
  {logto_subject:'subject',organisation_id:'foreign',expires_at:new Date('2027-01-01')},
  {logto_subject:'subject',organisation_id:ID,expires_at:'not-date'}
 ]){
  const ctx=setup({rows:[row]});
  assert.equal(await ctx.store.find(DIGEST),null);
 }
});
