import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {verifyCanonicalDbAtStartup} from '../src/pg-canonical-startup.mjs';
import {CANONICAL_RELATIONS,CANONICAL_FOREIGN_KEYS} from '../src/canonical-schema-contract.mjs';
const require=createRequire(new URL('../../../apps/control-api/package.json',import.meta.url));
const {Pool}=require('pg');
const uri=new URL(process.env.CONFIG_TEST_DATABASE_URL);
uri.username='titan_config_api_login';uri.password='ci-config-api-only';
const pool=new Pool({connectionString:uri.href,max:2});
try{
 const result=await verifyCanonicalDbAtStartup(pool);
 assert.ok(CANONICAL_RELATIONS.every(t=>result.relations.includes(t)));
 const actual=new Set(result.foreignKeys.map(f=>[f.table,f.column,f.target].join('|')));
 assert.ok(CANONICAL_FOREIGN_KEYS.every(f=>actual.has(f.join('|'))));
 console.log('verified actual pinned shared-company schema using a restricted database login');
}finally{await pool.end()}
