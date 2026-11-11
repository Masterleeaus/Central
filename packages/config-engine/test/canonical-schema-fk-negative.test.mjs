import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCanonicalSchema} from '../src/canonical-schema-contract.mjs';
const valid={relations:["titan.companies","titan.identities","titan.company_memberships","titan.application_entitlements","titan.application_company_links","titan.application_user_links","titan.schema_migrations"],foreignKeys:[{"table":"titan.company_memberships","column":"company_id","target":"titan.companies"},{"table":"titan.company_memberships","column":"identity_id","target":"titan.identities"},{"table":"titan.application_entitlements","column":"company_id","target":"titan.companies"},{"table":"titan.application_company_links","column":"company_id","target":"titan.companies"},{"table":"titan.application_user_links","column":"company_id","target":"titan.companies"},{"table":"titan.application_user_links","column":"identity_id","target":"titan.identities"},{"table":"titan_config.service_company_grants","column":"company_id","target":"titan.companies"}]};
test('missing config company grant FK fails closed',()=>{
 assert.throws(()=>assertCanonicalSchema({...valid,foreignKeys:valid.foreignKeys.slice(0,-1)}));
});
