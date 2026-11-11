import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigDbRuntime} from '../src/config-db-runtime.mjs';
const url=u=>'postgresql://'+u+':secret@db.test/database?sslmode=verify-full&sslrootcert=%2Fca.pem';
test('restricted pools close exactly once under concurrent shutdown',async()=>{
 const ended=[];class Pool{constructor(o){this.name=new URL(o.connectionString).username}async end(){ended.push(this.name)}}
 const runtime=createConfigDbRuntime({Pool,env:{TITAN_CONFIG_ENABLED:'true',
 TITAN_CONFIG_READ_DATABASE_URL:url('titan_config_api_login'),
 TITAN_CONFIG_GRANTS_DATABASE_URL:url('titan_config_grants_login')}});
 await Promise.all([runtime.close(),runtime.close()]);
 assert.deepEqual(ended.sort(),['titan_config_api_login','titan_config_grants_login']);
});
