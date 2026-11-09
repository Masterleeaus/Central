import test from 'node:test';import assert from 'node:assert/strict';
import {authenticateSkilledService} from '../src/service-decision-auth.mjs';
import {token} from './service-decision-harness.mjs';
test('exact separately configured bearer authorizes',()=>assert.equal(authenticateSkilledService('Bearer '+token,token),true));
for(const invalid of ['','Bearer short','Basic '+token,'bearer '+token,'Bearer '+token+'x','Bearer '+token+'\r\nOther:1'])
 test('different or malformed credential denied',()=>assert.equal(authenticateSkilledService(invalid,token),false));
test('missing configured secret never allows',()=>assert.equal(authenticateSkilledService('Bearer '+token,''),false));