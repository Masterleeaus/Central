// Issue #32: durable one-use organisation selection store (migration 0016). Fake client only; the real database
// behaviour is verified by tests/sql/organisation_selection.sql against PostgreSQL 16.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPostgresOrganisationSelectionStore,pruneExpiredSelections} from '../src/organisation-selection-pg.mjs';
import {createOidcHttpAdapter} from '../src/oidc-http-adapter.mjs';

const NOW=1_800_000_000_000;
const clock=()=>NOW;
const digest=value=>createHash('sha256').update(value).digest('base64url');
const BIND='A'.repeat(43), STATE_D=digest('state-1'), SEL_H=digest('token-1');
const record=(over={})=>({bindingHash:BIND,stateDigest:STATE_D,selectionHash:SEL_H,issuer:'https://auth.titan.example',subject:'sub-A',
  organisationIds:['org-a','org-b'],sealedIdToken:'sealed.token.value',expiresAt:NOW+300_000,...over});
const TX=/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL ROLE)/;
/** Fake pool: every connection records its statements. Transaction control succeeds; other statements go to handler(sql, values). */
function txPool(handler,log=[]){
  return {log,connect:async()=>({query:async(q,v)=>{log.push(q);if(TX.test(q))return {rows:[],rowCount:0};return handler(q,v)},release(err){log.push(err===undefined?'RELEASE':'DESTROY')}})};
}

test('save stores only digests and the candidate list, as titan_trusted_writer in one transaction',async()=>{
  const log=[];let params;
  const pool=txPool(async(q,v)=>{params=v;return {rows:[],rowCount:1}},log);
  await createPostgresOrganisationSelectionStore({pool,applicationId:'desk',clock}).save(record());
  assert.equal(log[0],'BEGIN');assert.equal(log[1],'SET LOCAL ROLE titan_trusted_writer');
  assert.match(log[2],/^INSERT INTO titan\.titan_oidc_organisation_selections/);
  assert.doesNotMatch(log[2],/created_at|consumed_at/,'created_at takes its default and consumed_at starts null');
  assert.equal(log[3],'COMMIT');assert.equal(log.at(-1),'RELEASE');
  assert.deepEqual(params.slice(0,5),['desk',BIND,STATE_D,SEL_H,'https://auth.titan.example']);
  assert.deepEqual(params[6],['org-a','org-b']);
  assert.equal(params[8],NOW+300_000);
  assert.equal(JSON.stringify(params).includes('state-1'),false,'raw state never reaches the database');
});

test('save refuses malformed records before any database call',async()=>{
  const log=[];const store=createPostgresOrganisationSelectionStore({pool:txPool(async()=>({rows:[]}),log),applicationId:'desk',clock});
  const bad=[
    record({bindingHash:'short'}),record({stateDigest:'x'.repeat(42)}),record({selectionHash:'has space'.padEnd(43,'a')}),
    record({organisationIds:['org-a']}),record({organisationIds:['org-a','org-a']}),record({organisationIds:['org a','org-b']}),
    record({organisationIds:Array.from({length:129},(_,i)=>`org-${i}`)}),
    record({subject:''}),record({issuer:'x'.repeat(513)}),
    record({expiresAt:NOW}),record({expiresAt:NOW+600_001}),record({expiresAt:1.5}),
    record({sealedIdToken:'x'.repeat(32769)}),record({sealedIdToken:''}),
  ];
  for(const r of bad) await assert.rejects(store.save(r),TypeError,JSON.stringify(Object.keys(r)));
  assert.deepEqual(log,[]);
});

test('save accepts a record without an ID-token vault (sealedIdToken null)',async()=>{
  const pool=txPool(async()=>({rows:[],rowCount:1}));
  await createPostgresOrganisationSelectionStore({pool,applicationId:'field',clock}).save(record({sealedIdToken:null}));
});

test('consume claims the row in one statement only while unconsumed and unexpired, then returns it',async()=>{
  const log=[];let sql;let values;
  const pool=txPool(async(q,v)=>{sql=q;values=v;return {rows:[{state_digest:STATE_D,selection_hash:SEL_H,issuer:'https://auth.titan.example',subject:'sub-A',organisation_ids:['org-a','org-b'],sealed_id_token:'sealed.token.value',expires_at:new Date(NOW+300_000)}],rowCount:1}},log);
  const out=await createPostgresOrganisationSelectionStore({pool,applicationId:'desk',clock}).consume(BIND);
  assert.deepEqual(out,{bindingHash:BIND,stateDigest:STATE_D,selectionHash:SEL_H,issuer:'https://auth.titan.example',subject:'sub-A',organisationIds:['org-a','org-b'],sealedIdToken:'sealed.token.value',expiresAt:NOW+300_000});
  assert.match(sql,/consumed_at IS NULL/);assert.match(sql,/expires_at > to_timestamp/);assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/UPDATE titan\.titan_oidc_organisation_selections/);assert.match(sql,/SET consumed_at=.*sealed_id_token=NULL/);
  assert.match(sql,/RETURNING c\.state_digest.*c\.sealed_id_token/,'the sealed token is returned from the claimed row, not the nulled one');
  assert.deepEqual(values,['desk',BIND,NOW]);
  assert.equal(log[1],'SET LOCAL ROLE titan_trusted_writer');assert.equal(log.at(-2),'COMMIT');
});

test('a replayed, expired or unknown selection consumes to null (one use, fail closed)',async()=>{
  const store=createPostgresOrganisationSelectionStore({pool:txPool(async()=>({rows:[],rowCount:0})),applicationId:'desk',clock});
  assert.equal(await store.consume(BIND),null);
});

test('consume rejects malformed bindings without touching the database',async()=>{
  const log=[];const store=createPostgresOrganisationSelectionStore({pool:txPool(async()=>{throw Error('unexpected')},log),applicationId:'desk',clock});
  for(const v of ['bad',undefined,null,42,'A'.repeat(44)]) assert.equal(await store.consume(v),null);
  assert.deepEqual(log,[]);
});

test('a row that reads back malformed fails closed to null',async()=>{
  const bad=[{organisation_ids:'org-a',state_digest:STATE_D,selection_hash:SEL_H,expires_at:new Date(NOW)},
    {organisation_ids:['org-a','org-b'],state_digest:'short',selection_hash:SEL_H,expires_at:new Date(NOW)},
    {organisation_ids:['org-a','org-b'],state_digest:STATE_D,selection_hash:SEL_H,expires_at:'not-a-date'}];
  for(const row of bad){
    const store=createPostgresOrganisationSelectionStore({pool:txPool(async()=>({rows:[row],rowCount:1})),applicationId:'desk',clock});
    assert.equal(await store.consume(BIND),null);
  }
});

test('a database error during consume propagates and rolls back, so the adapter can fail closed',async()=>{
  const log=[];const store=createPostgresOrganisationSelectionStore({pool:txPool(async()=>{throw Object.assign(new Error('permission denied for table'),{code:'42501'})},log),applicationId:'desk',clock});
  await assert.rejects(store.consume(BIND),/permission denied/);
  assert.deepEqual(log.slice(-2),['ROLLBACK','RELEASE']);
});

test('constructor refuses an unknown application or a pool without connect',()=>{
  assert.throws(()=>createPostgresOrganisationSelectionStore({pool:txPool(async()=>({})),applicationId:'admin',clock}),TypeError);
  assert.throws(()=>createPostgresOrganisationSelectionStore({pool:{query:async()=>({rows:[]})},applicationId:'desk',clock}),TypeError);
});

test('prune deletes expired or consumed rows in bounded batches as titan_trusted_writer',async()=>{
  const log=[];const batches=[3,3,1];let sql;const values=[];
  const pool=txPool(async(q,v)=>{sql=q;values.push(v);return {rows:[],rowCount:batches.shift()}},log);
  assert.equal(await pruneExpiredSelections(pool,clock,{batchSize:3}),7);
  assert.match(sql,/DELETE FROM titan\.titan_oidc_organisation_selections/);
  assert.match(sql,/expires_at <= to_timestamp/);assert.match(sql,/consumed_at IS NOT NULL/);
  assert.deepEqual(values[0],[NOW,3]);
  assert.equal(log.filter(x=>x==='SET LOCAL ROLE titan_trusted_writer').length,3);
});

test('prune refuses invalid configuration',async()=>{
  const pool=txPool(async()=>({rowCount:0}));
  await assert.rejects(pruneExpiredSelections({connect:null},clock),TypeError);
  await assert.rejects(pruneExpiredSelections(pool,clock,{batchSize:0}),TypeError);
  await assert.rejects(pruneExpiredSelections(pool,clock,{batchSize:10_001}),TypeError);
});

test('the OIDC adapter binds the one-use OIDC state digest into the pending record it saves',async()=>{
  const saved=[];
  const adapter=createOidcHttpAdapter({applicationId:'desk',afterLogin:'/',clock,
    oidcLogin:{begin:async()=>({authorizationUrl:'https://auth.titan.example/oidc/auth'}),complete:async()=>({subject:'sub-A',issuer:'https://auth.titan.example',idToken:'h.p.s'})},
    resolveLocalIdentity:async()=>({selectionRequired:true,organisationIds:['org-a','org-b']}),
    establishSession:async()=>'desk_sid='+'k'.repeat(40)+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600',
    organisationSelection:{store:{save:async r=>saved.push(r),consume:async()=>null},resolveOrganisation:async()=>({authorised:false})}});
  const res={status:null,headers:null,body:'',writeHead(s,h){this.status=s;this.headers=h},end(s=''){this.body=s}};
  await adapter({url:'/auth/titan/desk/callback?state=state-1&code=c',method:'GET',headers:{cookie:`titan_desk_oidc_binding=${BIND}`}},res);
  assert.equal(res.status,200);
  assert.equal(saved.length,1);
  assert.equal(saved[0].stateDigest,STATE_D);
  assert.equal(saved[0].bindingHash,digest(BIND));
  assert.equal(JSON.stringify(saved[0]).includes('state-1'),false);
});
