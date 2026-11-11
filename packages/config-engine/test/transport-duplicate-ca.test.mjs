import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('duplicate sslrootcert rejected',()=>{assert.throws(()=>assertVerifiedPostgresTransport('postgresql://u:p@localhost/db?sslmode=verify-full&sslrootcert=%2Fca.pem&sslrootcert=%2Fother.pem'))});
