import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRestrictedRole} from '../src/role-guard.mjs';
test('config service rejects BYPASSRLS login',async()=>{
 await assert.rejects(assertRestrictedRole({query:async()=>({rows:[{role:'titan_config_reader',privileged:true}]})},'titan_config_reader'));
});
