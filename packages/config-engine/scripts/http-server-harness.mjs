import {createRequire} from 'node:module';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServer as createNetServer} from 'node:net';
import assert from 'node:assert/strict';
import {startCentralService} from '../../../apps/control-api/src/server.mjs';
const require=createRequire(new URL('../../../apps/control-api/package.json',import.meta.url));
const issuer='https://issuer.integration.test/',audience='https://api.integration.test/config',jwksUri='https://issuer.integration.test/oidc/jwks';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'http-integration',alg:'RS256',use:'sig'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export const flagsPath='/v1/config/evaluate?key=ci_flag&application=central&environment=stage';
export function serviceBearer(clientId,overrides={}){
 const now=Math.floor(Date.now()/1000),header=b64({alg:'RS256',typ:'JWT',kid:'http-integration'});
 const payload=b64({iss:issuer,aud:audience,sub:'service-machine',client_id:clientId,iat:now-5,exp:now+120,...overrides});
 return 'Bearer '+header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
}
export async function freePort(){
 const s=createNetServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok)});
 const n=s.address().port;await new Promise((ok,no)=>s.close(e=>e?no(e):ok()));return n;
}
export function buildCiPoolAdapter({onPool=()=>{},grantOverride}={}){
 const admin=process.env.CONFIG_TEST_DATABASE_URL;if(!admin)throw Error('requires disposable CI database');
 const {Pool:PgPool}=require('pg');
 const base=new URL(admin);
 const dbUrl=(role,pass)=>{
  const u=new URL(base.href);u.username=role;u.password=pass;
  u.searchParams.set('sslmode','verify-full');u.searchParams.set('sslrootcert','/ci/mock-ca-not-used');
  return u.href;
 };
 class CiPgPool{
  constructor(options){
   const input=options.connectionString;
   if(input==='ci://operational-main'){this.role='central-test-main';this._main=true}
   else{
    const uri=new URL(input);this.role=uri.username;
    assert.equal(uri.hostname,'localhost');assert.equal(uri.searchParams.get('sslmode'),'verify-full');
    uri.search='';
    if(grantOverride&&this.role==='titan_config_grants_login')uri.username=grantOverride;
    this._pool=new PgPool({...options,connectionString:uri.href});
   }
   this._endCalls=0;onPool(this);
  }
  connect(){if(this._main)throw Error('main test pool cannot handle config SQL');return this._pool.connect()}
  query(sql){if(this._main){assert.equal(sql,'SELECT 1');return Promise.resolve({rows:[{one:1}]})}return this._pool.query(sql)}
  async end(){this._endCalls++;if(this._pool)await this._pool.end()}
 }
 return {Pool:CiPgPool,dbUrl};
}
export async function launchCiCentral({configEnabled=true,port,expectedHash,grantOverride,onPool}={}){
 const adapter=buildCiPoolAdapter({grantOverride,onPool});
 const env={
 TITAN_CENTRAL_DATABASE_URL:'ci://operational-main',TITAN_OIDC_ISSUER:issuer,TITAN_OIDC_JWKS_URI:jwksUri,
 TITAN_FIELD_AUDIENCE:'field-ci',TITAN_DESK_AUDIENCE:'desk-ci',TITAN_ACADEMY_AUDIENCE:'academy-ci',
 TITAN_CENTRAL_PORT:String(port??await freePort()),TITAN_CONFIG_ENABLED:String(configEnabled)};
 if(configEnabled)Object.assign(env,{TITAN_CONFIG_MIGRATION_APPROVED:'true',TITAN_CONFIG_CANONICAL_MIGRATION_ID:'0001_shared_company_core',
 TITAN_CONFIG_CANONICAL_MIGRATION_SHA256:expectedHash??process.env.TITAN_CONFIG_CANONICAL_MIGRATION_SHA256,
 TITAN_CONFIG_AUDIENCE:audience,TITAN_CONFIG_SALT:'ci-signed-jwt-config-rollout-secret',
 TITAN_CONFIG_READ_DATABASE_URL:adapter.dbUrl('titan_config_api_login','ci-config-api-only'),
 TITAN_CONFIG_GRANTS_DATABASE_URL:adapter.dbUrl('titan_config_grants_login','ci-config-grants-only')});
 let jwksCalls=0;
 const service=await startCentralService({env,loadPg:async()=>({Pool:adapter.Pool}),
 verifyToken:async()=>{throw Error('field verifier cannot validate service bearer')},
 fetcher:async url=>{assert.equal(url,jwksUri);jwksCalls++;return{ok:true,json:async()=>({keys:[jwk]})}},
 logger:()=>{}});
 assert.equal(service.server.address().address,'127.0.0.1');
 return {service,env,baseUrl:'http://127.0.0.1:'+service.server.address().port,jwksCount:()=>jwksCalls};
}
export async function httpRequest(baseUrl,path,{clientId='svc_a',headers={},method='GET',claims,auth=true}={}){
 const h={...headers};if(auth)h.authorization=serviceBearer(clientId,claims);
 const response=await fetch(baseUrl+path,{method,headers:h,signal:AbortSignal.timeout(5000)});
 return {status:response.status,headers:response.headers,body:await response.json()};
}
