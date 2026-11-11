import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('must use postgres scheme',()=>{assert.throws(()=>assertVerifiedPostgresTransport('https://u:p@localhost/db?sslmode=verify-full&sslrootcert=%2Fca.pem'))});
