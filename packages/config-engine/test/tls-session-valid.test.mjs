import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPgTlsSession} from '../src/pg-transport-session.mjs';
test('active backend TLS status accepted',async()=>{let released=false;const pool={connect:async()=>({query:async()=>({rows:[{ssl:true,version:'TLSv1.3',cipher:'TLS_AES'}]}),release(){released=true}})};assert.equal((await verifyPgTlsSession(pool)).tls,true);assert.ok(released)});
