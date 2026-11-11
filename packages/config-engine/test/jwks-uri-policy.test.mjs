import test from 'node:test';
import assert from 'node:assert/strict';
import {createJwksProvider} from '../src/jwks-provider.mjs';
test('JWKS URI may not redirect to another origin or insecure endpoint',()=>{
 assert.throws(()=>createJwksProvider({issuer:'https://login.test/',jwksUri:'https://attacker.test/jwks'}));
 assert.throws(()=>createJwksProvider({issuer:'https://login.test/',jwksUri:'http://login.test/jwks'}));
 assert.equal(typeof createJwksProvider({issuer:'https://login.test/',jwksUri:'https://login.test/oidc/jwks'}),'function');
});
