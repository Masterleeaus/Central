import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('CA root must be supplied',()=>{assert.throws(()=>assertVerifiedPostgresTransport('postgresql://u:p@localhost/db?sslmode=verify-full'));assert.throws(()=>assertVerifiedPostgresTransport('postgresql://u:p@localhost/db?sslmode=verify-full&sslrootcert='))});
