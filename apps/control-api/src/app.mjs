import { CentralAccessService, withCentralReadSnapshot, recordActivityInOwnTransaction } from '../../../packages/control-plane/dist/index.js';
import { randomUUID } from 'node:crypto';
import { createRateLimiter } from './rate-limit.mjs';

const apps=new Set(['field','desk','academy']);
const noStore={ 'cache-control':'no-store', 'content-type':'application/json; charset=utf-8', 'x-content-type-options':'nosniff' };
function respond(res, status, body, extra={}) {res.writeHead(status,{...noStore,...extra});res.end(JSON.stringify(body));}
function bearer(req) {const h=req.headers.authorization;if(typeof h!=='string'||!/^Bearer [A-Za-z0-9_\-.]+$/.test(h)) return;return h.slice(7);}
const withTimeout=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),ms);timer.unref?.();})]).finally(()=>clearTimeout(timer));};
/** Per-process defaults. Production limits must ALSO be enforced at the reverse proxy (Apache or nginx on the DirectAdmin host):
 * this in-process limiter is per instance and resets on restart. Behind a proxy the socket address is the proxy's,
 * so supply `clientIp` that reads the address set by a proxy you trust; never trust a client-sent X-Forwarded-For. */
const DEFAULT_RATE_LIMITS = Object.freeze({ ip:{limit:600,windowMs:60_000}, subject:{limit:300,windowMs:60_000} });
/** One distinct audience per application (ADR-005). A shared audience would let a token issued for one app pass for another, so there is no single-audience fallback. */
function perApplicationAudiences(audiences) {
  if (!audiences || typeof audiences!=='object') throw new Error('per-application audiences required');
  const map={field:audiences.field,desk:audiences.desk,academy:audiences.academy};
  const values=Object.values(map);
  if (values.some(v=>typeof v!=='string'||v.length===0||v.length>256) || new Set(values).size!==3) throw new Error('per-application audiences required');
  return Object.freeze(map);
}
/** Access decisions in the activity history (issue #16, on the #36 recorder).
 * Every allow and deny from CentralAccessService.authorise is written as one titan.activity_events row.
 * Stored: outcome, requested application and action, decision reason code, role (allow only), HTTP status.
 * Not stored: the bearer token, the Logto subject (the actor is the Central access check, not the caller),
 * raw error text. The recorder redacts the detail again before insert and refuses anything secret-shaped.
 *
 * Failure policy for a recorder outage (documented in docs/RETENTION.md, section 6):
 *  - Fail open for the response. A recording failure never changes the access response; the decision is
 *    returned exactly as before. Failing closed would turn an audit outage into an access outage.
 *  - Fail visible in the logs. Each failure writes one `activity_record_failed` line with the error class only.
 *    The line is the only record of a decision whose row was not written.
 *  - Bounded wait. The response waits at most RECORD_TIMEOUT_MS for the recorder, then goes out. A timed-out
 *    insert may still commit later; it is then logged as failed as well.
 *  - No retry and no in-memory queue. Nothing is buffered across requests, so a restart loses nothing that
 *    was not already written. */
export const RECORD_TIMEOUT_MS = 2000;
export function accessActivityInput({organisationId, applicationId, action, decision}) {
  const allowed = decision.allowed === true;
  return {
    organisationId,
    actorKind: 'service',
    actorId: 'central-access-check',
    action: 'access.check',
    targetType: 'organisation',
    targetId: organisationId,
    sourceProduct: 'central',
    outcome: allowed ? 'success' : 'denied',
    correlationId: `access-${randomUUID()}`,
    detail: allowed
      ? {decision:'allow', application:applicationId, action, reason:'allowed', role:decision.role, status:200}
      : {decision:'deny', application:applicationId, action, reason:decision.reason, status:403},
  };
}

/** No administrative mutations or user-controlled SQL. Organisation/app/action are the only request inputs.
 * logger(event, fields) receives structured decision fields only: never tokens or subject values. */
export function createCentralHandler({ pool, verifyToken, issuer, audiences, adminHandler, supportHandler, globalLogoutHandler, logoutLandingHandler, serviceDecisionHandler, configHandler, configEvaluationHandler, launcherSessionHandler, logger=()=>{}, healthQuery, activityRecorder, rateLimits=DEFAULT_RATE_LIMITS, clientIp=(req)=>req.socket?.remoteAddress??'unknown' }) {
  if (!pool || !verifyToken || !issuer) throw new Error('missing Central API dependencies');
  const trust={expectedIssuer:issuer,audienceByApplication:perApplicationAudiences(audiences)};
  const ipLimiter=createRateLimiter(rateLimits.ip);
  const subjectLimiter=createRateLimiter(rateLimits.subject);
  const audit=(event,fields={})=>{try{logger(event,fields);}catch{/* logging never alters the outcome */}};
  const runHealthQuery=healthQuery??((sql)=>pool.query(sql));
  const recordActivity=activityRecorder??((input)=>recordActivityInOwnTransaction(pool,input));
  // Never throws: a recording failure is logged and the caller's response goes out unchanged.
  const recordDecision=async (input)=>{
    try {await withTimeout(Promise.resolve().then(()=>recordActivity(input)),RECORD_TIMEOUT_MS);}
    catch (error) {audit('activity_record_failed',{error_class:error?.message==='timeout'?'RecordTimeout':(error?.name??'Error'),decision:input.detail.decision,application:input.detail.application});}
  };
  const route=async (req,res)=>{
    let url;
    try {url=new URL(req.url??'/', 'http://localhost');}catch{return respond(res,400,{error:'invalid_url'});}
    const pathname=url.pathname;
    if (req.method==='GET' && pathname==='/healthz') {
      try {await withTimeout(Promise.resolve().then(()=>runHealthQuery('SELECT 1')),2000);return respond(res,200,{status:'ok'});}
      catch {audit('healthz_database_unavailable');return respond(res,503,{status:'unavailable'});}
    }
    if (serviceDecisionHandler && await serviceDecisionHandler(req,res)) return;
    if (launcherSessionHandler && await launcherSessionHandler(req,res)) return;
    if (globalLogoutHandler && await globalLogoutHandler(req,res)) return;
    // Server-to-server config read (docs/CONFIG.md section 4). Off unless configHandler is given. Shares the per-IP limiter.
    if (pathname.startsWith('/internal/v1/config/')) {
      if (!configHandler) return respond(res,404,{error:'not_found'});
      const configIp=ipLimiter.take(clientIp(req));
      if (!configIp.allowed) {audit('config_rate_limited',{scope:'ip'});return respond(res,429,{error:'rate_limited'},{'retry-after':String(configIp.retryAfterSeconds)});}
      return configHandler(req,res);
    }
    if (pathname.startsWith('/v1/support/')) {
      // Support console (issue #39). Opt-in: unmounted unless a support handler is injected.
      if(!supportHandler) return respond(res,404,{error:'not_found'});
      if(await supportHandler(req,res)) return;
      return respond(res,404,{error:'not_found'});
    }
    if (logoutLandingHandler && await logoutLandingHandler(req,res)) return;
    if (pathname.startsWith('/v1/config/')) {
      if (!configEvaluationHandler) return respond(res,404,{error:'not_found'});
      if (await configEvaluationHandler(req,res)) return;
      return respond(res,404,{error:'not_found'});
    }
    if (pathname.startsWith('/v1/admin/')) {
      if(!adminHandler) return respond(res,404,{error:'not_found'});
      if(await adminHandler(req,res)) return;
      return respond(res,404,{error:'not_found'});
    }
    if (pathname!=='/v1/access/check') return respond(res,404,{error:'not_found'});
    if (req.method!=='GET') return respond(res,405,{error:'method_not_allowed'});
    // Per-IP limit runs before token verification so floods cannot force signature work.
    const ipDecision=ipLimiter.take(clientIp(req));
    if (!ipDecision.allowed) {audit('access_rate_limited',{scope:'ip'});return respond(res,429,{error:'rate_limited'},{'retry-after':String(ipDecision.retryAfterSeconds)});}
    const token=bearer(req);if(!token) return respond(res,401,{error:'unauthenticated'});
    let principal;
    try {principal=await verifyToken(token);} catch {audit('access_unauthenticated');return respond(res,401,{error:'unauthenticated'});}
    // Per-subject limit, keyed in memory only; the subject value is never logged.
    const subjectDecision=subjectLimiter.take(principal.logtoSubject);
    if (!subjectDecision.allowed) {audit('access_rate_limited',{scope:'subject'});return respond(res,429,{error:'rate_limited'},{'retry-after':String(subjectDecision.retryAfterSeconds)});}
    if (Array.from(url.searchParams.keys()).some(k=>!['organisation_id','application','action'].includes(k)) || Array.from(url.searchParams.keys()).some(k=>url.searchParams.getAll(k).length!==1)) return respond(res,400,{error:'invalid_parameters'});
    const organisationId=url.searchParams.get('organisation_id');
    const applicationId=url.searchParams.get('application');
    const action=url.searchParams.get('action');
    if (!organisationId || !/^[a-f0-9-]{36}$/i.test(organisationId) || !apps.has(applicationId) || !action || !/^[a-z][a-z0-9:_-]{0,79}$/.test(action)) return respond(res,400,{error:'invalid_parameters'});
    try {
      const decision=await withCentralReadSnapshot(pool, organisationId, repo=>new CentralAccessService(repo,trust).authorise({principal,organisationId,applicationId,action}));
      if (!decision.allowed) {
        audit('access_decision',{decision:'deny',application:applicationId,action,organisation_id:organisationId,reason:decision.reason,status:403});
        await recordDecision(accessActivityInput({organisationId,applicationId,action,decision}));
        return respond(res,403,{allowed:false,role:null,reason:decision.reason});
      }
      audit('access_decision',{decision:'allow',application:applicationId,action,organisation_id:organisationId,role:decision.role,status:200});
      await recordDecision(accessActivityInput({organisationId,applicationId,action,decision}));
      // Response is deliberately limited to allowed, role and a reason code. Identity IDs and revisions stay server-side.
      return respond(res,200,{allowed:true,role:decision.role,reason:'allowed'});
    } catch (e) {audit('access_error',{error_class:e?.name});return respond(res,503,{error:'access_unavailable'});}
  };
  return async (req,res)=>{
    try {await route(req,res);}
    catch (error) {
      audit('request_failed',{error_class:error?.name});
      try {
        if (!res.headersSent) respond(res,500,{error:'internal_error'});
        else res.end();
      } catch { /* socket already gone; the process must keep serving */ }
    }
  };
}
