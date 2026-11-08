import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralLauncherService} from '../src/central-launcher-service.mjs';
import {CENTRAL_COOKIE} from '../src/central-session.mjs';

const ORG='00000000-0000-4000-8000-000000000001';
const destinations={sorted:'https://sorted.example/',supercharged:'https://supercharged.example/',lms:'https://lms.example/'};
const record=new Map();
const sessionStore={
  async insert(row){record.set(row.digest,row);},
  async find(hash){return record.get(hash)||null;},
  async delete(hash){record.delete(hash);}
};
const fakePool={async connect(){return {
  async query(sql,args){
    if(sql.includes('FROM titan.identities'))return {rows:[{id:'identity',logto_subject:'issuer|subject',state:'active'}]};
    if(sql.includes('FROM titan.organisations'))return {rows:[{id:ORG,logto_organisation_id:'org-1',state:'active'}]};
    if(sql.includes('FROM titan.memberships'))return {rows:[{id:'membership',identity_id:'identity',organisation_id:ORG,role:'owner',state:'active',revision:1,expires_at:null}]};
    if(sql.includes('FROM titan.entitlements'))return {rows:[{id:'entitlement',organisation_id:ORG,application_id:args[1],state:'active',features:['session:open'],revision:1,expires_at:null}]};
    if(sql.includes('FROM titan.local_account_links'))return {rows:[{id:'link',identity_id:'identity',organisation_id:ORG,application_id:args[2],local_user_id:'user',local_account_id:'account',state:'verified',revision:1,verified_at:'2026-01-01T00:00:00Z'}]};
    return {rows:[]};
  },
  release(){}
}}};
function response(){return {status:0,body:'',headers:{},writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}}}
test('full trusted composition blocks unauthenticated browsers, then renders entitled products',async()=>{
  record.clear();
  const service=createCentralLauncherService({pool:fakePool,sessionStore,getCompanyName:async()=> 'Acme & Co',destinations});
  const denied=response();
  await service.handler({url:'/central',method:'GET',headers:{}},denied);
  assert.equal(denied.status,401);
  const issued=await service.sessions.issue({identityId:'issuer|subject',companyId:ORG});
  const req={url:'/central',method:'GET',headers:{cookie:issued.cookie.split(';')[0]}};
  assert.match(req.headers.cookie,new RegExp('^'+CENTRAL_COOKIE+'='));
  const allowed=response();
  await service.handler(req,allowed);
  assert.equal(allowed.status,200);
  assert.match(allowed.body,/Acme &amp; Co/);
  assert.match(allowed.body,/Open Sorted/);
  assert.match(allowed.body,/Open Supercharged/);
  assert.match(allowed.body,/Open LMS/);
  await service.sessions.revoke(req);
  const revoked=response();
  await service.handler(req,revoked);
  assert.equal(revoked.status,401);
});
