import {generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createPgAuthenticatedConfigHandler} from '../src/pg-config-composition.mjs';
const require=createRequire(new URL('../../../apps/control-api/package.json',import.meta.url));
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.CONFIG_TEST_DATABASE_URL,max:4});
const issuer='https://issuer.integration.test/',audience='https://api.integration.test/config';
const jwksUri='https://issuer.integration.test/oidc/jwks';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'integration',alg:'RS256',use:'sig'};
let jwksRequests=0;
const clock=()=>1800000000000,now=Math.floor(clock()/1000);
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function bearer(clientId,claims={}) {
 const header=encode({alg:'RS256',typ:'JWT',kid:'integration'});
 const body=encode({iss:issuer,aud:audience,sub:'machine',client_id:clientId,
  iat:now-10,exp:now+120,...claims});
 return 'Bearer '+header+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+body),privateKey).toString('base64url');
}
const handler=createPgAuthenticatedConfigHandler({
 configPool:pool,grantPool:pool,issuer,audience,jwksUri,salt:'e2e-fixed-rollout-secret',
 clock,fetcher:async url=>{
  assert.equal(url,jwksUri);jwksRequests++;
  return {ok:true,json:async()=>({keys:[jwk]})};
 }
});
async function request(clientId,{claims={},path,headers={}}={}){
 const req={method:'GET',url:path??'/v1/config/evaluate?key=ci_flag&application=central&environment=stage',
  headers:{authorization:bearer(clientId,claims),...headers}};
 const res={writeHead(status,h){this.status=status;this.headers=h},
  end(value){this.body=JSON.parse(value)}};
 assert.equal(await handler(req,res),true);
 return res;
}
try{
 const a=await request('svc_a');assert.equal(a.status,200);assert.equal(a.body.value,true);
 const c=await request('svc_c');assert.equal(c.status,200);assert.equal(c.body.value,false);
 assert.equal((await request('svc_revoked')).status,403);
 assert.equal((await request('svc_expired')).status,403);
 assert.equal((await request('svc_missing')).status,403);
 assert.equal((await request('svc_a',{claims:{aud:'https://wrong.test'}})).status,403);
 assert.equal((await request('svc_a',{headers:{'x-company-id':'550e8400-e29b-41d4-a716-446655440003'}})).status,400);
 assert.equal((await request('svc_a',{path:'/v1/config/evaluate?key=ci_flag&application=central&environment=stage&company_id=550e8400-e29b-41d4-a716-446655440003'})).status,400);
 assert.equal(jwksRequests,1);
 console.log('Real PostgreSQL + signed JWT company-isolation E2E passed');
}finally{await pool.end()}
