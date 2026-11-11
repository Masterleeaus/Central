import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfigDbSettings} from '../src/config-db-settings.mjs';
test('rejects placeholders and missing trusted root certificate',()=>{
 const base={TITAN_CONFIG_ENABLED:'true',TITAN_CONFIG_GRANTS_DATABASE_URL:'postgresql://titan_config_grants_login:secret@host.test/db?sslmode=verify-full&sslrootcert=%2Fca.pem'};
 assert.throws(()=>readConfigDbSettings({...base,TITAN_CONFIG_READ_DATABASE_URL:'REPLACE_ME'}));
 assert.throws(()=>readConfigDbSettings({...base,TITAN_CONFIG_READ_DATABASE_URL:'postgresql://titan_config_api_login:secret@host.test/db?sslmode=verify-full'}));
});
