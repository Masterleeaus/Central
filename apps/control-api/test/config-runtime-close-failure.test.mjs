import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigDbRuntime} from '../src/config-db-runtime.mjs';
const url=u=>'postgresql://'+u+':secret@db.test/database?sslmode=verify-full&sslrootcert=%2Fca.pem';
test('one restricted-pool failure never skips the other pool',async()=>{
 let called=0;class Pool{constructor(o){this.name=new URL(o.connectionString).username}async end(){called++;if(this.name==='titan_config_api_login')throw Error('disconnect')}}
 const runtime=createConfigDbRuntime({Pool,env:{TITAN_CONFIG_ENABLED:'true',
 TITAN_CONFIG_READ_DATABASE_URL:url('titan_config_api_login'),
 TITAN_CONFIG_GRANTS_DATABASE_URL:url('titan_config_grants_login')}});
 await assert.rejects(runtime.close(),AggregateError);assert.equal(called,2);
});
