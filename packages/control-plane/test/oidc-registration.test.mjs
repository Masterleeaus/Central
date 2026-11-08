import test from 'node:test';import assert from 'node:assert/strict';
import {createTitanOidcRegistrationPlans} from '../dist/index.js';
const origins={desk:'https://desk.titanzero.io',field:'https://field.titanzero.io',academy:'https://academy.titanzero.io'};
test('produces three distinct code+PKCE S256 clients',()=>{const plans=createTitanOidcRegistrationPlans(origins);assert.equal(plans.length,3);for(const p of plans){assert.equal(p.responseType,'code');assert.equal(p.pkce,'S256');assert.deepEqual(p.redirectUris,[`${p.origin}/auth/callback`]);}});
test('rejects HTTP',()=>assert.throws(()=>createTitanOidcRegistrationPlans({...origins,desk:'http://desk.titanzero.io'})));
test('rejects ambiguous duplicate origins',()=>assert.throws(()=>createTitanOidcRegistrationPlans({...origins,academy:origins.desk})));
test('rejects URI injection',()=>assert.throws(()=>createTitanOidcRegistrationPlans({...origins,desk:'https://desk.titanzero.io/?next=evil'})));
test('rejects embedded credentials',()=>assert.throws(()=>createTitanOidcRegistrationPlans({...origins,desk:'https://foo:bar@desk.titanzero.io'})));
