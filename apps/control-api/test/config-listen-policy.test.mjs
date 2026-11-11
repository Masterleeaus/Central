import test from 'node:test';
import assert from 'node:assert/strict';
import {centralListenPort} from '../src/config-listen-policy.mjs';
test('validates finite exact integer port without coercion',()=>{
 assert.equal(centralListenPort({TITAN_CENTRAL_PORT:'3102'}),3102);
 for(const v of ['', '0','65536','2.5','abc',' 3102','-1'])assert.throws(()=>centralListenPort({TITAN_CENTRAL_PORT:v}));
});
