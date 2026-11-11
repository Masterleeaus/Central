import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRuntimeLogin} from '../src/pg-runtime-login-check.mjs';
test('runtime login success',async()=>{
 const statements=[];let released=false;
 const c={query:async(q,args)=>{statements.push([q,args]);return q.includes('SELECT current_user')?{rows:[{"session_user_name":"titan_config_api_login","privileged":false,"role_member":true,"forbidden_member":false}]}:{rows:[]}},release(){released=true}};
 assert.equal((await verifyRuntimeLogin({connect:async()=>c},'config')).verified,true);
 assert.equal(statements.at(-1)[0],'COMMIT');assert.ok(released);
});
