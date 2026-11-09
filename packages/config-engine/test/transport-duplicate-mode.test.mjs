import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('duplicate sslmode rejected',()=>{assert.throws(()=>assertVerifiedPostgresTransport('postgresql://u:p@localhost/db?sslmode=verify-full&sslmode=disable&sslrootcert=%2Fca.pem'))});
