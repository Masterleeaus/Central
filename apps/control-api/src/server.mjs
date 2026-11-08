import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createCentralHandler } from './app.mjs';
import { createOidcVerifier } from './oidc.mjs';

export async function startCentralService({env=process.env, loadPg=()=>import('pg')}={}) {
  const {TITAN_CENTRAL_DATABASE_URL, TITAN_OIDC_ISSUER, TITAN_OIDC_JWKS_URI, TITAN_FIELD_AUDIENCE, TITAN_DESK_AUDIENCE, TITAN_ACADEMY_AUDIENCE}=env;
  if (![TITAN_CENTRAL_DATABASE_URL,TITAN_OIDC_ISSUER,TITAN_OIDC_JWKS_URI,TITAN_FIELD_AUDIENCE,TITAN_DESK_AUDIENCE,TITAN_ACADEMY_AUDIENCE].every(Boolean)) throw Error('missing Central service configuration');
  const audiences={field:TITAN_FIELD_AUDIENCE,desk:TITAN_DESK_AUDIENCE,academy:TITAN_ACADEMY_AUDIENCE};
  // One verifier per app audience; the first that accepts the token supplies principal.audience, which app.mjs then matches against the requested application.
  const verifiers=Object.values(audiences).map(audience=>createOidcVerifier({issuer:TITAN_OIDC_ISSUER,audience,jwksUri:TITAN_OIDC_JWKS_URI}));
  const verifyToken=async token=>{let lastError;for(const verify of verifiers){try{return await verify(token);}catch(e){lastError=e;}}throw lastError??Error('no audience matched');};
  const {Pool}=await loadPg();
  const pool=new Pool({connectionString:TITAN_CENTRAL_DATABASE_URL,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,application_name:'titan-central-api'});
  const handler=createCentralHandler({pool,verifyToken,issuer:TITAN_OIDC_ISSUER,audiences,logger:(event,error)=>console.error(event,error?.message)});
  const server=createServer(handler);
  const port=Number(env.TITAN_CENTRAL_PORT||3102);
  if (!Number.isInteger(port)||port<1||port>65535) throw Error('invalid port');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {server,pool,async close(){await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));await pool.end();}};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  startCentralService().then(()=>console.log('Titan Central API listening on loopback')).catch(e=>{console.error(e.message);process.exitCode=1});
}
