import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresLinkNonceClaimer} from '../src/product-link-nonce-pg.mjs';
const expires='2026-11-09T03:01:00.000Z';
function setup({outcome=true,fail=false}={}) {
 const queries=[],releases=[];const pool={connect:async()=>({
  query:async(sql,args)=>{queries.push([sql,args]);if(fail&&sql.startsWith('SELECT titan.'))throw Error('database private');
   return sql.startsWith('SELECT titan.')?{rows:[{claimed:outcome}]}:{rows:[]}},
  release:()=>releases.push(true)
 })};
 return {claim:createPostgresLinkNonceClaimer({pool,clock:()=>Date.parse('2026-11-09T03:00:00.000Z')}),queries,releases};
}
test('nonce is hashed, used by restricted SQL role, and transaction is committed once',async()=>{
 const x=setup(),raw='A'.repeat(43);
 assert.equal(await x.claim('field',raw,expires),true);
 assert.deepEqual(x.queries.map(v=>v[0]),['BEGIN','SET LOCAL ROLE titan_product_link_nonce',
  "SET LOCAL statement_timeout = '5000ms'",
  'SELECT titan.claim_product_link_proof_nonce($1,$2::char(64),$3::timestamptz) AS claimed','COMMIT']);
 assert.equal(x.queries[3][1][0],'field');
 assert.match(x.queries[3][1][1],/^[0-9a-f]{64}$/);
 assert.equal(x.queries[3][1][2],expires);
 assert.doesNotMatch(JSON.stringify(x.queries),/A{43}/);
 assert.equal(x.releases.length,1);
});
test('malformed claims never reach the database',async()=>{
 const x=setup();
 for(const [app,nonce,expiry] of [
  ['stranger','A'.repeat(43),expires],['field','bad',expires],
  ['field','A'.repeat(43),'yesterday'],
  ['field','A'.repeat(43),'2026-11-09T03:00:00.000Z'],
  ['field','A'.repeat(43),'2026-11-09T03:10:00.000Z']
 ])assert.equal(await x.claim(app,nonce,expiry),false);
 assert.equal(x.queries.length,0);
});
test('SQL exceptions rollback; all nonboolean or false outcomes fail closed',async()=>{
 const x=setup({fail:true});
 assert.equal(await x.claim('field','A'.repeat(43),expires),false);
 assert.equal(x.queries.at(-1)[0],'ROLLBACK');
 assert.equal(x.releases.length,1);
 for(const outcome of [false,null,'true',0]){
  const y=setup({outcome});
  assert.equal(await y.claim('field','A'.repeat(43),expires),false);
 }
});
test('a repeated raw nonce is domain-separated per product',async()=>{
 const x=setup();
 await x.claim('field','A'.repeat(43),expires);
 await x.claim('desk','A'.repeat(43),expires);
 assert.notEqual(x.queries[3][1][1],x.queries[8][1][1]);
});
test('untrusted database configuration is rejected',()=>{
 assert.throws(()=>createPostgresLinkNonceClaimer({pool:{}}),TypeError);
 assert.throws(()=>createPostgresLinkNonceClaimer({pool:{connect:async()=>{}},clock:null}),TypeError);
});
