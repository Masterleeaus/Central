import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfigQuery} from '../src/config-request-schema.mjs';
test('only exact product/key/environment query is permitted',()=>{
 const q={key:'feature',application:'central',environment:'stage'};
 assert.deepEqual(validateConfigQuery(q),q);
 assert.throws(()=>validateConfigQuery({...q,companyId:'forged'}));
 assert.throws(()=>validateConfigQuery({...q,environment:'bad value'}));
});
