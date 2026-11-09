import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfigDbSettings} from '../src/config-db-settings.mjs';
const uri=user=>'postgresql://'+user+':private-secret@db.example.test/config?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem';
const env={TITAN_CONFIG_ENABLED:'true',TITAN_CONFIG_READ_DATABASE_URL:uri('titan_config_api_login'),TITAN_CONFIG_GRANTS_DATABASE_URL:uri('titan_config_grants_login')};
test('verified-TLS and distinct service roles required',()=>{
 assert.equal(readConfigDbSettings(env).grants,env.TITAN_CONFIG_GRANTS_DATABASE_URL);
 assert.throws(()=>readConfigDbSettings({...env,TITAN_CONFIG_READ_DATABASE_URL:uri('postgres')}));
 assert.throws(()=>readConfigDbSettings({...env,TITAN_CONFIG_READ_DATABASE_URL:uri('titan_config_api_login').replace('verify-full','disable')}));
});
