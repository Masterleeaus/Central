import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
const get=createJwksProvider({issuer:'https://login.example.test/',jwksUri:'https://login.example.test/oidc/jwks',fetcher:async()=>({ok:false})});
test('JWKS HTTP failure denies key lookup',async()=>await assert.rejects(get('one')));
