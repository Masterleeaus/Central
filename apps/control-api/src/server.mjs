import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createCentralHandler } from './app.mjs';
import { createOidcVerifier } from './oidc.mjs';

export async function startCentralService({env=process.env, loadPg=()=>import('pg')}={}) {
  const {TITAN_CENTRAL_DATABASE_URL, TITAN_OIDC_ISSUER, TITAN_OIDC_AUDIENCE, TITAN_OIDC_JWKS_URI}=env;
  if (![TITAN_CENTRAL_DATABASE_URL,TITAN_OIDC_ISSUER,TITAN_OIDC_AUDIENCE,TITAN_OIDC_JWKS_URI].every(Boolean)) throw Error('missing Central service configuration');
  const {Pool}=await loadPg();
  const pool=new Pool({connectionString:TITAN_CENTRAL_DATABASE_URL,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,application_name:'titan-central-api'});
  const handler=createCentralHandler({pool,verifyToken:createOidcVerifier({issuer:TITAN_OIDC_ISSUER,audience:TITAN_OIDC_AUDIENCE,jwksUri:TITAN_OIDC_JWKS_URI}),issuer:TITAN_OIDC_ISSUER,audience:TITAN_OIDC_AUDIENCE,logger:(event,error)=>console.error(event,error?.message)});
  const server=createServer(handler);
  const port=Number(env.TITAN_CENTRAL_PORT||3102);
  if (!Number.isInteger(port)||port<1||port>65535) throw Error('invalid port');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {server,pool,async close(){await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));await pool.end();}};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  startCentralService().then(()=>console.log('Titan Central API listening on loopback')).catch(e=>{console.error(e.message);process.exitCode=1});
}
