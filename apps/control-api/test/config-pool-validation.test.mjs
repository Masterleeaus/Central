import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfigDbSettings} from '../src/config-db-settings.mjs';
test('invalid postgres scheme is rejected',()=>{
 const grants='postgresql://titan_config_grants_login:secret@host.test/db?sslmode=verify-full&sslrootcert=%2Fca.pem';
 assert.throws(()=>readConfigDbSettings({TITAN_CONFIG_ENABLED:'true',TITAN_CONFIG_READ_DATABASE_URL:'https://titan_config_api_login:secret@host.test/db?sslmode=verify-full&sslrootcert=%2Fca.pem',TITAN_CONFIG_GRANTS_DATABASE_URL:grants}));
});
