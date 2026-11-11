import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {verifyPgTlsSession} from '../src/pg-transport-session.mjs';
import {assertVerifiedPostgresTransport} from '../src/pg-transport-requirements.mjs';
const require=createRequire(new URL('../../../apps/control-api/package.json',import.meta.url));
const {Pool}=require('pg');
const admin=new URL(process.env.CONFIG_TEST_DATABASE_URL),ca=process.env.CONFIG_TLS_CA_FILE;
assert.match(readFileSync(ca,'utf8'),/BEGIN CERTIFICATE/);
const make=(user,password)=>{
 const uri=new URL(admin.href);uri.username=user;uri.password=password;
 uri.searchParams.set('sslmode','verify-full');uri.searchParams.set('sslrootcert',ca);
 return uri.href;
};
const connect=async uri=>{
 const pool=new Pool({connectionString:uri,max:1,connectionTimeoutMillis:3000});
 try{return await verifyPgTlsSession(pool)}finally{await pool.end()}
};
for(const [user,pass] of [['titan_config_api_login','ci-config-api-only'],
 ['titan_config_grants_login','ci-config-grants-only'],
 ['titan_config_grant_admin_login','ci-grant-admin-only'],
 ['titan_config_authority_login','ci-company-authority-only']]){
 const url=make(user,pass);
 assert.equal(assertVerifiedPostgresTransport(url).mode,'verify-full');
 assert.equal((await connect(url)).tls,true,user);
}
const wrong=new URL(make('titan_config_api_login','ci-config-api-only'));
wrong.searchParams.set('sslrootcert','/tmp/not-a-real-ca.pem');
await assert.rejects(connect(wrong.href));
console.log('Four real restricted PostgreSQL TLS connections and bad CA denial passed');
