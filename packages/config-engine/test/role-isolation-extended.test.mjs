import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRestrictedRole} from '../src/role-guard.mjs';
test('rejects privileged service database role',async()=>{
 await assert.rejects(assertRestrictedRole({query:async()=>({rows:[{role:'titan_config_writer',privileged:true}]})},'titan_config_writer'));
});
