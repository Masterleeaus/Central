// Global logout revocations write the signed session_revoked event in the same transaction as the bump (issue #6, #102).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSessionRevocations} from '../src/session-revocation-pg.mjs';

const ORG='33333333-3333-4333-8333-333333333333';
/** Pool that records statements per connection and can fail the outbox write. */
function pool({failOutbox=false}={}){
 const log=[];const outbox=[];let generation=0;
 return {log,outbox,async connect(){return {
  async query(q,p){
   log.push(q.split('\n')[0].slice(0,50));
   if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT set_config)/.test(q))return {rows:[],rowCount:0};
   if(q.startsWith('INSERT INTO titan.titan_session_revocations')){generation++;return {rows:[{generation}],rowCount:1};}
   if(q.startsWith('INSERT INTO titan.outbox_events')){if(failOutbox)throw Error('outbox unavailable');outbox.push({organisation_id:p[0],source_product:p[1],event_type:p[2],idempotency_key:p[5],payload:JSON.parse(p[6])});return {rows:[{id:'e'}],rowCount:1};}
   throw Error('unhandled SQL in fixture: '+q.slice(0,60));
  },
  release(){}};}};
}
test('revokeAll commits the bump and the session_revoked event together and returns the generation',async()=>{
 const p=pool();
 const revocations=createPostgresSessionRevocations({pool:p});
 assert.equal(await revocations.revokeAll({applicationId:'desk',logtoSubject:'usr_1',organisationId:ORG}),1);
 assert.equal(p.outbox.length,1);
 assert.deepEqual(p.outbox[0].payload,{applicationId:'desk',logtoSubject:'usr_1',generation:1});
 assert.equal(p.outbox[0].organisation_id,ORG);
 assert.equal(p.outbox[0].event_type,'session_revoked');
 assert.equal(p.outbox[0].source_product,'central');
 assert.equal(p.log.at(-1),'COMMIT');
});
test('a failed event write rolls back the revocation and confirms nothing',async()=>{
 const p=pool({failOutbox:true});
 await assert.rejects(createPostgresSessionRevocations({pool:p}).revokeAll({applicationId:'field',logtoSubject:'usr_1',organisationId:ORG}),/outbox unavailable/);
 assert.equal(p.log.at(-1),'ROLLBACK');
});
