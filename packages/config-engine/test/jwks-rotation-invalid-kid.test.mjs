import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
test('invalid kid rejected before fetching JWKS',async()=>{let calls=0;const get=createJwksProvider({issuer:'https://login.example.test/',jwksUri:'https://login.example.test/jwks',fetcher:async()=>{calls++}});await assert.rejects(get('../key'));assert.equal(calls,0)});
