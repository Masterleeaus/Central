import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
test('no URL fragments',()=>{assert.throws(()=>assertVerifiedPostgresTransport('postgresql://u:p@localhost/db?sslmode=verify-full&sslrootcert=%2Fca.pem#fragment'))});
