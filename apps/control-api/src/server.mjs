import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createCentralHandler } from './app.mjs';
import { createOidcVerifier } from './oidc.mjs';
import { createJsonLogger } from './structured-log.mjs';
import { insecureLocalhostAllowed } from './endpoint-policy.mjs';
import { createMetrics, pathnameOf, serveMetrics } from './metrics.mjs';
import { createOperatorAdmin, loadProductRegistry } from './operator-config.mjs';
import { ORGANISATION_CLAIM, COHORT_CLAIM, createConfigReadHandler, createServiceIdentityVerifier, productAudience } from './config-read.mjs';
import { FLAG_DECLARATIONS } from './config-declarations.mjs';
import { FLAG_PRODUCTS, createFlagRegistry, createPostgresFlagStore } from '../../../packages/control-plane/dist/index.js';
import { readServiceDecisionConfig } from './service-decision-config.mjs';
import { createSkilledDecisionHandler } from './service-decision-handler.mjs';
import { readLinkKeySets } from './link-key-config.mjs';
import { createConfigDbRuntime } from './config-db-runtime.mjs';
import { createProductionConfigRoute } from './config-production-route.mjs';
import { assertConfigStartup } from './config-startup-guard.mjs';
import { verifyConfigRuntimeReadiness } from './config-runtime-readiness.mjs';
import { closeFailedStartup } from './config-runtime-cleanup.mjs';
import { centralListenPort } from './config-listen-policy.mjs';
import { createServiceLifecycle } from './service-lifecycle.mjs';
import { listenCentral } from './service-startup-listener.mjs';
const log = createJsonLogger();

/** TITAN_CONFIG_READ_PRODUCTS: comma-separated products allowed to read flags. Unset means the read endpoint is not served. */
export function readConfigProducts(env) {
  const raw = env.TITAN_CONFIG_READ_PRODUCTS;
  if (raw === undefined || raw === '') return [];
  const list = raw.split(',').map(s => s.trim());
  if (list.some(p => !FLAG_PRODUCTS.includes(p)) || new Set(list).size !== list.length) throw new Error('invalid TITAN_CONFIG_READ_PRODUCTS');
  return list;
}

export async function startCentralService({env=process.env, loadPg=()=>import('pg'), fetcher, verifyToken:verifyOverride, logger=log}={}) {
  const {TITAN_CENTRAL_DATABASE_URL, TITAN_OIDC_ISSUER, TITAN_OIDC_JWKS_URI, TITAN_FIELD_AUDIENCE, TITAN_DESK_AUDIENCE, TITAN_ACADEMY_AUDIENCE}=env;
  if (![TITAN_CENTRAL_DATABASE_URL,TITAN_OIDC_ISSUER,TITAN_OIDC_JWKS_URI,TITAN_FIELD_AUDIENCE,TITAN_DESK_AUDIENCE,TITAN_ACADEMY_AUDIENCE].every(Boolean)) throw Error('missing Central service configuration');
  const audiences={field:TITAN_FIELD_AUDIENCE,desk:TITAN_DESK_AUDIENCE,academy:TITAN_ACADEMY_AUDIENCE};
  // One verifier per app audience; the first that accepts the token supplies principal.audience, which app.mjs then matches against the requested application.
  const verifiers=Object.values(audiences).map(audience=>createOidcVerifier({issuer:TITAN_OIDC_ISSUER,audience,jwksUri:TITAN_OIDC_JWKS_URI,allowInsecureLocalhost:insecureLocalhostAllowed(env)}));
  const verifyToken=verifyOverride??(async token=>{let lastError;for(const verify of verifiers){try{return await verify(token);}catch(e){lastError=e;}}throw lastError??Error('no audience matched');});
  // Decision and failure events feed the metrics counters and then the structured log, unchanged.
  const metrics=createMetrics();
  const auditLog=(event,fields)=>{try{metrics.observeLog(event,fields);}catch{/* metrics never alter a request */}logger(event,fields);};
  // Link assertion keys are validated here, whether or not the operator plane is on: a malformed key fails startup.
  const linkKeySets=readLinkKeySets(env);
  // Product registry: validated at every startup, so bad product origins stop startup even with the operator plane off.
  const productRegistry=loadProductRegistry(env);
  assertConfigStartup(env);
  const {Pool}=await loadPg();
  const pool=new Pool({connectionString:TITAN_CENTRAL_DATABASE_URL,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,application_name:'titan-central-api'});
  // Feature flags (issue #38): declarations in code, PostgreSQL store on the trusted reader and writer roles.
  const flagRegistry=createFlagRegistry(FLAG_DECLARATIONS);
  const flagStore=createPostgresFlagStore(pool);
  // Operator plane: null unless TITAN_OPERATOR_* is set, in which case /v1/admin/ is mounted. Invalid settings throw here.
  let adminHandler;
  try { adminHandler=createOperatorAdmin({env,verifyToken,metrics,logger:auditLog,fetcher,flags:{registry:flagRegistry,store:flagStore},productRegistry,pool,linkKeySets}); }
  catch (e) { await pool.end().catch(()=>{}); throw e; }
  // Service read endpoint: one verifier per product audience, each accepting only urn:titan-central:product:<product>.
  const readProducts=readConfigProducts(env);
  const configHandler=readProducts.length ? createConfigReadHandler({
    verifyServiceToken:createServiceIdentityVerifier(new Map(readProducts.map(product=>[product,createOidcVerifier({issuer:TITAN_OIDC_ISSUER,audience:productAudience(product),jwksUri:TITAN_OIDC_JWKS_URI,allowInsecureLocalhost:insecureLocalhostAllowed(env),claimNames:[ORGANISATION_CLAIM,COHORT_CLAIM]})]))),
    registry:flagRegistry,store:flagStore,logger:auditLog,
  }) : undefined;
  const decisionConfig=readServiceDecisionConfig(env);
  const serviceDecisionHandler=decisionConfig?createSkilledDecisionHandler({pool,...decisionConfig,logger:auditLog}):undefined;
  let configRuntime, configEvaluationHandler, port;
  try {
    port=centralListenPort(env);
    configRuntime=createConfigDbRuntime({env,Pool});
    if (configRuntime) await verifyConfigRuntimeReadiness({runtime:configRuntime,env});
    configEvaluationHandler=createProductionConfigRoute({env,runtime:configRuntime,fetcher,logger:auditLog});
  } catch(error) {
    await closeFailedStartup({pool,runtime:configRuntime});
    throw Error('configuration startup failed',{cause:error});
  }
  const centralHandler=createCentralHandler({pool,verifyToken,issuer:TITAN_OIDC_ISSUER,audiences,adminHandler:adminHandler??undefined,configHandler,configEvaluationHandler,serviceDecisionHandler,logger:auditLog});
  const handler=async (req,res)=>{
    res.on('finish',()=>{try{metrics.observeResponse(res.statusCode);}catch{/* ignore */}});
    if (req.method==='GET' && pathnameOf(req)==='/metrics') return serveMetrics(req,res,metrics);
    return centralHandler(req,res);
  };
  const server=createServer(handler);
  try{await listenCentral(server,port)}
  catch(error){await closeFailedStartup({pool,runtime:configRuntime});throw Error('central HTTP listen failed',{cause:error})}
  const lifecycle=createServiceLifecycle({server,pool,runtime:configRuntime});
  return {server,pool,close:lifecycle.close};
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
