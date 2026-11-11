import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPgTlsSession} from '../src/pg-transport-session.mjs';
test('ambiguous backend TLS session denied',async()=>{const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}})};await assert.rejects(verifyPgTlsSession(pool))});
