import assert from 'node:assert/strict';
import {launchCiCentral,freePort} from './http-server-harness.mjs';
const expected=process.env.TITAN_CONFIG_CANONICAL_MIGRATION_SHA256;
for(const item of [{name:'wrong hash',expectedHash:'0'.repeat(64)},{name:'wrong grant principal',grantOverride:'titan_config_api_login'}]){
 const pools=[];
 await assert.rejects(launchCiCentral({...item,onPool:p=>pools.push(p)}));
 assert.equal(pools.length,3,item.name);
 assert.ok(pools.every(p=>p._endCalls===1),item.name+' leaked PostgreSQL resources');
}
const occupying=await launchCiCentral({configEnabled:false,port:await freePort()});
try{
 const pools=[];
 await assert.rejects(launchCiCentral({port:occupying.service.server.address().port,expectedHash:expected,onPool:p=>pools.push(p)}));
 assert.equal(pools.length,3);
 assert.ok(pools.every(p=>p._endCalls===1),'bind collision leaked SQL resources');
}finally{await occupying.service.close()}
console.log('Real receipt mismatch, login mismatch and bind collision failure cleanup passed');
