import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorisedGrantWriter} from '../src/authorised-grant-writer.mjs';
test('denied company access never reaches SQL writer',async()=>{
 let writes=0;
 const service=createAuthorisedGrantWriter({writer:{create:async()=>{writes++},transition:async()=>{writes++}},
 authoriseOperator:async()=>true,authorizeCompany:async()=>false});
 await assert.rejects(service.create({logtoSubject:'operator_1',operatorAuthorityVerified:true},{clientId:'service_1',product:'central',environment:'staging',companyId:'550e8400-e29b-41d4-a716-446655440000',state:'active',cohorts:[]}));
 assert.equal(writes,0);
});
