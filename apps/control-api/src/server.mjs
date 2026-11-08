import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createCentralHandler } from './app.mjs';
import { createOidcVerifier } from './oidc.mjs';
import { createJsonLogger } from './structured-log.mjs';
import { insecureLocalhostAllowed } from './endpoint-policy.mjs';
import { createMetrics, pathnameOf, serveMetrics } from './metrics.mjs';
import { createOperatorAdmin } from './operator-config.mjs';
import { createCentralBrowserRouter } from './central-browser-router.mjs';
import { createCanonicalCompanySource } from './central-shared-bootstrap.mjs';
const log = createJsonLogger();

export async function startCentralService({env=process.env, loadPg=()=>import('pg'), fetcher, verifyToken:verifyOverride, logger=log, getCompanyName, createBrowserRouter=createCentralBrowserRouter}={}) {
  const {TITAN_CENTRAL_DATABASE_URL, TITAN_OIDC_ISSUER, TITAN_OIDC_JWKS_URI, TITAN_FIELD_AUDIENCE, TITAN_DESK_AUDIENCE, TITAN_ACADEMY_AUDIENCE}=env;
  if (![TITAN_CENTRAL_DATABASE_URL,TITAN_OIDC_ISSUER,TITAN_OIDC_JWKS_URI,TITAN_FIELD_AUDIENCE,TITAN_DESK_AUDIENCE,TITAN_ACADEMY_AUDIENCE].every(Boolean)) throw Error('missing Central service configuration');
  const audiences={field:TITAN_FIELD_AUDIENCE,desk:TITAN_DESK_AUDIENCE,academy:TITAN_ACADEMY_AUDIENCE};
  // One verifier per app audience; the first that accepts the token supplies principal.audience, which app.mjs then matches against the requested application.
  const verifiers=Object.values(audiences).map(audience=>createOidcVerifier({issuer:TITAN_OIDC_ISSUER,audience,jwksUri:TITAN_OIDC_JWKS_URI,allowInsecureLocalhost:insecureLocalhostAllowed(env)}));
  const verifyToken=verifyOverride??(async token=>{let lastError;for(const verify of verifiers){try{return await verify(token);}catch(e){lastError=e;}}throw lastError??Error('no audience matched');});
  // Decision and failure events feed the metrics counters and then the structured log, unchanged.
  const metrics=createMetrics();
  const auditLog=(event,fields)=>{try{metrics.observeLog(event,fields);}catch{/* metrics never alter a request */}logger(event,fields);};
  // Operator plane: null unless TITAN_OPERATOR_* is set, in which case /v1/admin/ is mounted. Invalid settings throw here.
  const adminHandler=createOperatorAdmin({env,verifyToken,metrics,logger:auditLog,fetcher});
  const {Pool}=await loadPg();
  const pool=new Pool({connectionString:TITAN_CENTRAL_DATABASE_URL,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,application_name:'titan-central-api'});
  let browserRouter,sharedPool;
  try {
    let nameProvider=getCompanyName;
    if(env.TITAN_CENTRAL_BROWSER_ENABLED==='1'&&!nameProvider){
      const canonical=await createCanonicalCompanySource({legacyUrl:TITAN_CENTRAL_DATABASE_URL,
        sharedUrl:env.TITAN_CENTRAL_SHARED_DATABASE_URL,Pool});
      sharedPool=canonical.sharedPool;
      nameProvider=canonical.getCompanyName;
    }
    browserRouter=createBrowserRouter({env,pool,getCompanyName:nameProvider,fetcher,logger:auditLog});
  } catch(error){
    try{await sharedPool?.end();}catch{/* startup error wins */}
    await pool.end();
    throw error;
  }
  const centralHandler=createCentralHandler({pool,verifyToken,issuer:TITAN_OIDC_ISSUER,audiences,adminHandler:adminHandler??undefined,logger:auditLog});
  const handler=async (req,res)=>{
    res.on('finish',()=>{try{metrics.observeResponse(res.statusCode);}catch{/* ignore */}});
    if (req.method==='GET' && pathnameOf(req)==='/metrics') return serveMetrics(req,res,metrics);
    if(browserRouter && await browserRouter.handler(req,res))return;
    return centralHandler(req,res);
  };
  const server=createServer(handler);
  const port=Number(env.TITAN_CENTRAL_PORT||3102);
  if (!Number.isInteger(port)||port<1||port>65535) throw Error('invalid port');
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  }catch(error){
    await Promise.allSettled([pool.end(),...(sharedPool?[sharedPool.end()]:[])]);
    throw error;
  }
  return {server,pool,async close(){
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
    await Promise.all([pool.end(),...(sharedPool?[sharedPool.end()]:[])]);
  }};
}
// Closes the HTTP server and the database pool on SIGTERM/SIGINT, then exits.
// A second signal after the first is left to the default handler (hard stop).
export function installShutdown(service,{proc=process,exit=(code)=>process.exit(code),timeoutMs=10000,log=console}={}) {
  let closing=false;
  const stop=signal=>{
    if (closing) return;
    closing=true;
    log.log(`${signal} received, closing Titan Central API`);
    const deadline=setTimeout(()=>{log.error('shutdown timed out');exit(1)},timeoutMs);
    service.close().then(()=>{clearTimeout(deadline);exit(0)},e=>{clearTimeout(deadline);log.error(e?.message);exit(1)});
  };
  proc.once('SIGTERM',()=>stop('SIGTERM'));
  proc.once('SIGINT',()=>stop('SIGINT'));
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  startCentralService().then(service=>{console.log('Titan Central API listening on loopback');installShutdown(service)}).catch(e=>{console.error(e.message);process.exitCode=1});
}
