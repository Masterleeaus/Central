import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {launchCiCentral,httpRequest,flagsPath,serviceBearer} from './http-server-harness.mjs';
const require=createRequire(new URL('../../../apps/control-api/package.json',import.meta.url));
const {Pool}=require('pg');
const db=new Pool({connectionString:process.env.CONFIG_TEST_DATABASE_URL});
let live;
try{
 live=await launchCiCentral();
 const token=serviceBearer('svc_a');
 const query=async()=>{
  const r=await fetch(live.baseUrl+flagsPath,{headers:{authorization:token},signal:AbortSignal.timeout(5000)});
  return r.status;
 };
 assert.equal(await query(),200);
 try{
  await db.query("UPDATE titan_config.service_company_grants SET state='revoked',revision=revision+1 WHERE client_id='svc_a' AND state='active'");
  assert.equal(await query(),403,'still-valid signed service token cannot bypass revoked database grant');
 }finally{
  await db.query("UPDATE titan_config.service_company_grants SET state='active',revision=revision+1 WHERE client_id='svc_a' AND state='revoked'");
 }
 assert.equal(await query(),200,'restored service grant is independently evaluated');
 console.log('Same signed JWT observed live Postgres grant revoke and re-enable immediately');
}finally{if(live)await live.service.close();await db.end()}
