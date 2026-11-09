import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresProductSelectionStore} from '../src/product-selection-pg.mjs';
const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const token='x'.repeat(43);
const time=Date.parse('2026-11-09T03:00:00.000Z');
const record={issuer:'https://id.example/',subject:'verified-subject',
 bindingHash:'a'.repeat(64),organisationIds:[A,B],expiresAt:time+300000};
function setup({app='field',rows,broken=false}={}){
 const calls=[],state=new Map();
 const pool={async connect(){return{
  async query(sql,args){
   calls.push([sql,args]);
   if(broken&&sql.startsWith('INSERT'))throw Error('database failed');
   if(sql.startsWith('INSERT')){
    state.set(args[0]+'/'+args[1],{binding_hash:args[2],
     sealed_issuer:args[3],sealed_subject:args[4],sealed_company_ids:args[5],
     expires_at:new Date(args[6])});
    return {rows:[{state_digest:args[1]}]};
   }
   if(sql.startsWith('DELETE')&&sql.includes('application_id=$1')){
    const row=state.get(args[0]+'/'+args[1]);
    state.delete(args[0]+'/'+args[1]);
    return {rows:row&&row.expires_at.getTime()>args[2]?[row]:[]};
   }
   if(sql.startsWith('DELETE'))return {rows:[]};
   return {rows:[]};
  },release(){calls.push(['RELEASE'])}
 }}};
 const sealer={seal:(value,aad)=>'sealed('+aad+')'+value,
  open:(value,aad)=>{const prefix='sealed('+aad+')';
   if(!value.startsWith(prefix))throw Error('invalid aad');
   return value.slice(prefix.length)}};
 return {store:createPostgresProductSelectionStore({pool,applicationId:app,sealer,clock:()=>time}),
  calls,state};
}
test('stores only digest and individually AEAD-bound sensitive fields',async()=>{
 const x=setup();await x.store.save(token,record);
 const query=x.calls.find(([sql])=>sql.startsWith('INSERT'));
 assert.equal(query[1][0],'field');
 assert.match(query[1][1],/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(x.calls).includes(token));
 assert.ok(query[1][4].startsWith('sealed('));
 assert.ok(query[1][4].includes('|subject)'));
 assert.ok(!query[0].includes('verified-subject'));
 assert.deepEqual(x.calls.map(x=>x[0]).slice(0,4),
  ['BEGIN','SET LOCAL ROLE titan_product_selection',"SET LOCAL statement_timeout = '5000ms'",
   query[0]]);
});
test('app-specific namespace prevents cross-product state consumption',async()=>{
 const x=setup({app:'field'});await x.store.save(token,record);
 assert.deepEqual(await x.store.consume(token),record);
 assert.equal(await x.store.consume(token),null);
 const y=setup({app:'desk'});await y.store.save(token,record);
 assert.notEqual([...x.state.keys()][0],[...y.state.keys()][0]);
});
test('wrong field AEAD context yields denied selection',async()=>{
 const x=setup();await x.store.save(token,record);
 const entry=x.state.values().next().value;
 entry.sealed_subject=entry.sealed_issuer;
 assert.equal(await x.store.consume(token),null);
 assert.equal(await x.store.consume(token),null);
});
test('invalid and duplicated companies denied before SQL',async()=>{
 const x=setup();
 for(const bad of [{...record,organisationIds:[A,A]},
  {...record,organisationIds:[]},
  {...record,organisationIds:['foreign']},
  {...record,expiresAt:time+900000},
  {...record,bindingHash:'short'}]){
  await assert.rejects(()=>x.store.save(token,bad),TypeError);
 }
 assert.equal(x.calls.length,0);
});
test('SQL failures rollback and release connection',async()=>{
 const x=setup({broken:true});
 await assert.rejects(()=>x.store.save(token,record),/database failed/);
 assert.ok(x.calls.some(([sql])=>sql==='ROLLBACK'));
 assert.equal(x.calls.at(-1)[0],'RELEASE');
});
test('invalid state or app registration cannot be used',async()=>{
 const x=setup();
 assert.equal(await x.store.consume('untrusted'),null);
 await assert.rejects(()=>x.store.save('invalid',record),TypeError);
 assert.throws(()=>setup({app:'central'}),TypeError);
});
test('pruning is bounded and app-scoped',async()=>{
 const x=setup();
 assert.equal(await x.store.prune({limit:3}),0);
 assert.ok(x.calls.find(([sql,args])=>sql.startsWith('DELETE')&&sql.includes('SKIP LOCKED')&&args[0]==='field'&&args[1]===3));
 await assert.rejects(()=>x.store.prune({limit:5001}),TypeError);
});
