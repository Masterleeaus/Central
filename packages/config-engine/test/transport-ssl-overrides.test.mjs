import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('ssl overrides cannot defeat certificate validation',()=>{assert.throws(()=>assertVerifiedPostgresTransport('postgresql://u:p@localhost/db?sslmode=verify-full&sslrootcert=%2Fca.pem&ssl=false'))});
