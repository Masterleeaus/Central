import test from 'node:test';
import assert from 'node:assert/strict';
import {LogtoManagementVerifier,createOrganisationProvisioningAuthorizer} from '../dist/index.js';
const role='role_admin';const actor={logtoSubject:'user_a',managementCredentialVerified:true};
const membership={kind:'membership',id:'x',organisationId:'local-org',identityId:'x',role:'member'};
const response=x=>({ok:true,json:async()=>x});
function build(members=['user_a'], roles=[{id:role}],err=false){
 const paths=[];
 const verifier=new LogtoManagementVerifier({origin:'https://id.example.test',accessToken:async()=> 'trusted-bearer-token',fetcher:async url=>{
  const u=new URL(url);paths.push(u.pathname);
  if(err)return {ok:false};
  if(u.pathname==='/api/users/user_a')return response({id:'user_a'});
  if(u.pathname==='/api/organizations/org_a')return response({id:'org_a'});
  if(u.pathname==='/api/users/user_a/organizations')return response(members.includes('user_a')?[{id:'org_a'}]:[]);
  if(u.pathname==='/api/organizations/org_a/users/user_a/roles')return response(roles);
  return {ok:false};
 }});
 const policy=createOrganisationProvisioningAuthorizer({verifier,resolve:async()=> 'org_a',administrativeRoleIds:[role]});
 return {policy,verifier,paths};
}
test('accepts current org administrator',async()=>assert.equal(await build().policy(actor,membership),true));
test('rejects ordinary org member',async()=>assert.equal(await build(['user_a'],[{id:'member_role'}]).policy(actor,membership),false));
test('rejects revoked membership even if role remains',async()=>assert.equal(await build([], [{id:role}]).policy(actor,membership),false));
test('rejects role removed after prior allowed decision',async()=>{let held=true;const b=build();const verifier=b.verifier;const orig=verifier.assertAnyOrganisationRole.bind(verifier);verifier.assertAnyOrganisationRole=async(...args)=>{if(!held)throw Error('revoked');return orig(...args)};assert.equal(await b.policy(actor,membership),true);held=false;await assert.rejects(b.policy(actor,membership));});
test('rejects noncredential actor',async()=>assert.equal(await build().policy({logtoSubject:'user_a',managementCredentialVerified:false},membership),false));
test('rejects absent canonical org',async()=>assert.equal(await createOrganisationProvisioningAuthorizer({verifier:build().verifier,resolve:async()=>undefined,administrativeRoleIds:[role]})(actor,membership),false));
test('fails on unavailable management API',async()=>assert.equal(await build(['user_a'],[{id:role}],true).policy(actor,membership),false));
test('does not grant identity or organisation creation to org admins',async()=>{const p=build().policy;assert.equal(await p(actor,{kind:'identity'}),false);assert.equal(await p(actor,{kind:'organisation'}),false)});
test('requires explicit role IDs',()=>assert.throws(()=>createOrganisationProvisioningAuthorizer({verifier:build().verifier,resolve:async()=> 'org_a',administrativeRoleIds:[]})));
test('rejects malformed role records',async()=>assert.equal(await build(['user_a'],[{name:'owner'}]).policy(actor,membership),false));
