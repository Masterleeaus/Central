import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCanonicalIntegrationReadiness} from '../src/canonical-integration-readiness.mjs';
test('structural and CI success cannot replace actual migration approval',()=>{
 const valid={schemaVerified:true,restrictedRolesVerified:true,signedJwtVerified:true,approvedMigration:false};
 assert.throws(()=>assertCanonicalIntegrationReadiness(valid));
 assert.equal(assertCanonicalIntegrationReadiness({...valid,approvedMigration:true}),true);
});
