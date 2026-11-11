import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRestrictedRole} from '../src/role-guard.mjs';
test('database connections must match expected restricted role',async()=>{const client={query:async()=>({rows:[{role:'titan_config_reader',privileged:false}]})};await assert.doesNotReject(assertRestrictedRole(client,'titan_config_reader'));await assert.rejects(assertRestrictedRole(client,'titan_config_writer'));});
