import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
test('JWKS must be hosted by exact trusted issuer origin',()=>assert.throws(()=>createJwksProvider({issuer:'https://login.example.test/',jwksUri:'https://attacker.test/jwks'})));
