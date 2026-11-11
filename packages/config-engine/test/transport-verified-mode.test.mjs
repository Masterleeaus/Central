import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('only verify-full accepted',()=>{const u='postgresql://u:p@localhost/db?sslmode=verify-full&sslrootcert=%2Fca.pem';assert.equal(assertVerifiedPostgresTransport(u).mode,'verify-full');for(const v of ['disable','allow','prefer','require','verify-ca'])assert.throws(()=>assertVerifiedPostgresTransport(u.replace('verify-full',v)))});
