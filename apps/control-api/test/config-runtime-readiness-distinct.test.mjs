import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConfigRuntimeReadiness} from '../src/config-runtime-readiness.mjs';
test('one shared pool cannot satisfy two role checks',async()=>{
 const p={connect(){}};
 await assert.rejects(verifyConfigRuntimeReadiness({runtime:{configPool:p,grantPool:p},env:{TITAN_CONFIG_MIGRATION_APPROVED:'true'}}));
});
