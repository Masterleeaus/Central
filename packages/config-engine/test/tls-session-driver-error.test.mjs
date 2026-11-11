import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPgTlsSession} from '../src/pg-transport-session.mjs';
test('SQL error always releases TLS connection',async()=>{let released=false;const pool={connect:async()=>({query:async()=>{throw Error('failure')},release(){released=true}})};await assert.rejects(verifyPgTlsSession(pool));assert.ok(released)});
