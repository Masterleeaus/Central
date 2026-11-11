import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfigStartup} from '../src/config-startup-guard.mjs';
test('approved reviewed receipt accepted with complete enabled configuration',()=>{
 const env={TITAN_CONFIG_ENABLED:'true',TITAN_CONFIG_MIGRATION_APPROVED:'true',
 TITAN_CONFIG_CANONICAL_MIGRATION_ID:'0001_shared_company_core',TITAN_CONFIG_CANONICAL_MIGRATION_SHA256:'a'.repeat(64),
 TITAN_OIDC_ISSUER:'https://issuer.test/',TITAN_OIDC_JWKS_URI:'https://issuer.test/oidc/jwks',
 TITAN_CONFIG_AUDIENCE:'https://api.example.test/config',TITAN_CONFIG_SALT:'long-application-rollout-secret',
 TITAN_CONFIG_READ_DATABASE_URL:'dedicated',TITAN_CONFIG_GRANTS_DATABASE_URL:'separate'};
 assert.equal(assertConfigStartup(env),true);
});
