import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRestrictedRole} from '../src/role-guard.mjs';
test('rejects privileged DB actors',async()=>{
 await assert.doesNotReject(assertRestrictedRole({query:async()=>({rows:[{role:'titan_config_reader',privileged:false}]})},'titan_config_reader'));
 await assert.rejects(assertRestrictedRole({query:async()=>({rows:[{role:'postgres',privileged:true}]})},'titan_config_reader'));
});
