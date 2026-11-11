import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPgTlsSession} from '../src/pg-transport-session.mjs';
test('unencrypted backend denied',async()=>{let released=false;const pool={connect:async()=>({query:async()=>({rows:[{ssl:false}]}),release(){released=true}})};await assert.rejects(verifyPgTlsSession(pool));assert.ok(released)});
