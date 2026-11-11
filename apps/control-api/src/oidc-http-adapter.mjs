/** Framework-neutral OIDC browser route adapter. App-owned sessions stay app-owned.
 * Mount only on exact paths and supply trusted local session and account binding.
 * Callback requests are rate-limited per client IP before the token exchange, and per
 * verified subject afterwards. Production limits must also be set at the reverse proxy.
 *
 * Optional, all off by default (existing behaviour unchanged when omitted):
 * - idTokenVault + storeIdToken: after a successful sign-in the verified ID token is sealed for this session
 *   (oidc-id-token-store.mjs) and handed to storeIdToken({applicationId, sessionId, subject, sealed}) for the
 *   app's session store. establishSession must then return {cookie, sessionId}.
 * - organisationSelection: {store, resolveOrganisation}. When the user belongs to several eligible organisations
 *   the callback answers 200 with the candidate list and a selection token, and POST /auth/titan/{app}/select-organisation
 *   completes the sign-in. The store must be durable, shared and atomic: consume(bindingHash) returns and deletes
 *   the pending record in one step (see the contract in test/oidc-organisation-selection.test.mjs).
 *   Production uses createPostgresOrganisationSelectionStore (organisation-selection-pg.mjs, migration 0016).
 *   The saved record also carries stateDigest, the SHA-256 (base64url) of the one-use OIDC state.
 *   Without it, several organisations still fail closed with 403.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { oidcStartPath, oidcCallbackPath } from '../../../packages/control-plane/dist/applications.js';
import { bindingCookiePolicy, appSessionCookiePolicy, buildPolicyCookie, buildClearCookie, isPolicySetCookie } from './oidc-cookie-policy.mjs';
import { insecureLocalhostAllowed, isSecureEndpoint } from './endpoint-policy.mjs';
import { createRateLimiter } from './rate-limit.mjs';

const allowedApps = new Set(['desk', 'field', 'academy']);
const token = () => randomBytes(32).toString('base64url');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9:_-]{1,200}$/;
const DEFAULT_RATE_LIMITS = Object.freeze({ ip: { limit: 30, windowMs: 60_000 }, subject: { limit: 10, windowMs: 60_000 } });
const SELECTION_TTL_MS = 300_000;
const SELECTION_BODY_LIMIT = 512;
const sha = value => createHash('sha256').update(value).digest('base64url');
const sameDigest = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const reply = (res, status, body, extra = {}) => {
  res.writeHead(status, {'cache-control':'no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff',...extra});
  res.end(JSON.stringify(body));
};
const redirect = (res, destination, cookie) => {
  res.writeHead(303, {location:destination,'cache-control':'no-store', ...(cookie?{'set-cookie':cookie}:{})});
  res.end();
};
const parseCookies = (req) => {
  const header=req.headers.cookie;
  if (typeof header!=='string'||header.length>8192) return {};
  const cookies=Object.create(null);
  for (const item of header.split(';')) {
    const separator=item.indexOf('='); if(separator<1)continue;
    const key=item.slice(0,separator).trim(); const value=item.slice(separator+1).trim();
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(key)||Object.hasOwn(cookies,key))continue;
    cookies[key]=value;
  }
  return cookies;
};
// Reads a small JSON body. JSON-only content type: a cross-site HTML form cannot send it without a preflight.
const readJson = async (req, limit) => {
  const type=req.headers?.['content-type'];
  if (typeof type!=='string'||!/^application\/json(;\s*charset=utf-8)?$/i.test(type)) throw new Error('unsupported_media_type');
  let size=0; const chunks=[];
  for await (const chunk of req) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=buffer.length; if(size>limit) throw new Error('body_too_large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const validBinding = value => typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const errorClass = error => (typeof error?.name==='string' ? error.name : 'unknown');
const validLocal = local => local && local.authorised===true && typeof local.localUserId==='string' && local.localUserId.length>0 && typeof local.localAccountId==='string' && local.localAccountId.length>0 && typeof local.organisationId==='string' && local.organisationId.length>0;

/**
 * oidcLogin: Pass 10 flow with Pass 11 state store and ID-token verifier.
 * resolveLocalIdentity: app-owned lookup of issuer + subject, never by email alone.
 * establishSession: app-owned session rotation/creation; returns the opaque session cookie
 *   (a string), or {cookie, sessionId} when ID-token storage is enabled.
 * On absent identity, fail closed rather than implicitly creating a privileged account.
 * logger(event, fields) receives structured outcome fields only: never tokens, subjects or codes.
 */
export function createOidcHttpAdapter({applicationId,oidcLogin,resolveLocalIdentity,establishSession,afterLogin='/',logger=()=>{},
  allowInsecureLocalhost=insecureLocalhostAllowed(),rateLimits=DEFAULT_RATE_LIMITS,clientIp=(req)=>req.socket?.remoteAddress??'unknown',
  idTokenVault=null,storeIdToken=null,organisationSelection=null,clock=()=>Date.now()}={}) {
  if(!allowedApps.has(applicationId)||!oidcLogin?.begin||!oidcLogin?.complete||typeof resolveLocalIdentity!=='function'||typeof establishSession!=='function'||typeof afterLogin!=='string'||!afterLogin.startsWith('/')||afterLogin.startsWith('//')||/[\r\n]/.test(afterLogin))throw new TypeError('invalid OIDC route adapter configuration');
  if((idTokenVault===null)!==(storeIdToken===null)||(idTokenVault!==null&&(typeof idTokenVault.seal!=='function'||typeof idTokenVault.open!=='function'||typeof storeIdToken!=='function')))throw new TypeError('invalid id token storage configuration');
  if(organisationSelection!==null&&(typeof organisationSelection.store?.save!=='function'||typeof organisationSelection.store?.consume!=='function'||typeof organisationSelection.resolveOrganisation!=='function'))throw new TypeError('invalid organisation selection configuration');
  const ipLimiter=createRateLimiter(rateLimits.ip);
  const subjectLimiter=createRateLimiter(rateLimits.subject);
  const audit=(event,fields={})=>{try{logger(event,{application:applicationId,...fields});}catch{/* logging never alters the outcome */}};
  const bindingPolicy=bindingCookiePolicy(applicationId);
  const sessionPolicy=appSessionCookiePolicy(applicationId);
  const clear=buildClearCookie(bindingPolicy);
  const expectedStart=oidcStartPath(applicationId);
  const expectedCallback=oidcCallbackPath(applicationId);
  const expectedSelect=`/auth/titan/${applicationId}/select-organisation`;

  const requireIdToken = verified => {
    if(typeof verified?.idToken!=='string') throw Error('id_token_unavailable');
    return verified.idToken;
  };

  /** Establishes the app session and, when enabled, stores the sealed ID token. Returns the session cookie. */
  async function issueSession(local, verified) {
    if (idTokenVault) requireIdToken(verified); // checked before any session exists, so no orphan session is created
    const established=await establishSession({applicationId,localUserId:local.localUserId,localAccountId:local.localAccountId,organisationId:local.organisationId,oidcSubject:verified.subject,oidcIssuer:verified.issuer});
    const cookie=typeof established==='string'?established:established?.cookie;
    const sessionId=typeof established==='object'&&established!==null?established.sessionId:undefined;
    if (!isPolicySetCookie(sessionPolicy,cookie)) throw Error('unsafe_session_cookie');
    if (idTokenVault) {
      const sealed=idTokenVault.seal({idToken:requireIdToken(verified),sessionId,subject:verified.subject});
      await storeIdToken({applicationId,sessionId,subject:verified.subject,sealed});
    }
    return cookie;
  }

  /** Records the pending choice, bound to the browser binding and the one-use state. Returns null when selection is not possible. */
  async function startSelection(binding, verified, organisationIds, stateDigest) {
    if (!organisationSelection) return null;
    if (!Array.isArray(organisationIds) || organisationIds.length<2 || organisationIds.length>128 || organisationIds.some(id=>typeof id!=='string'||!ID.test(id))) return null;
    const selectionToken=token();
    const selectionHash=sha(selectionToken);
    const sealedIdToken=idTokenVault?idTokenVault.seal({idToken:requireIdToken(verified),sessionId:selectionHash,subject:verified.subject}):null;
    await organisationSelection.store.save({bindingHash:sha(binding),stateDigest,selectionHash,issuer:verified.issuer,subject:verified.subject,organisationIds:[...organisationIds],sealedIdToken,expiresAt:clock()+SELECTION_TTL_MS});
    return {organisations:[...organisationIds],selectionToken};
  }

  /** POST /auth/titan/{app}/select-organisation: JSON {organisation_id, selection_token}, bound to the browser binding cookie. */
  async function handleSelection(req, res) {
    if (!organisationSelection) { reply(res,404,{error:'not_found'}); return true; }
    if (req.method!=='POST') { reply(res,405,{error:'method_not_allowed'},{allow:'POST'}); return true; }
    const ipDecision=ipLimiter.take(clientIp(req));
    if (!ipDecision.allowed) { audit('login_rate_limited',{scope:'ip'}); reply(res,429,{error:'rate_limited'},{'retry-after':String(ipDecision.retryAfterSeconds)}); return true; }
    const fail=(status,reason)=>{res.writeHead(status,{'cache-control':'no-store','content-type':'application/json','set-cookie':clear});res.end(JSON.stringify({error:reason}));};
    if (req.headers?.['sec-fetch-site']!=='same-origin') { audit('selection_rejected',{reason:'origin_denied'}); fail(403,'origin_denied'); return true; }
    const binding=parseCookies(req)[bindingPolicy.name];
    if (!validBinding(binding)) { audit('selection_rejected',{reason:'missing_binding'}); fail(403,'selection_rejected'); return true; }
    let body;
    try { body=await readJson(req,SELECTION_BODY_LIMIT); } catch { audit('selection_rejected',{reason:'invalid_body'}); fail(400,'invalid_selection'); return true; }
    if (!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='organisation_id,selection_token'||typeof body.organisation_id!=='string'||!ID.test(body.organisation_id)||typeof body.selection_token!=='string'||!TOKEN.test(body.selection_token)) {
      audit('selection_rejected',{reason:'invalid_body'}); fail(400,'invalid_selection'); return true;
    }
    let pending;
    try { pending=await organisationSelection.store.consume(sha(binding)); }
    catch { audit('selection_failed',{reason:'store_unavailable'}); fail(503,'selection_unavailable'); return true; }
    // consume() deletes the pending record, so any wrong or replayed attempt also ends this selection (one use).
    if (!pending || !(pending.expiresAt>clock()) || !sameDigest(pending.selectionHash, sha(body.selection_token))) { audit('selection_rejected',{reason:'expired_or_tampered'}); fail(403,'selection_rejected'); return true; }
    if (!Array.isArray(pending.organisationIds) || !pending.organisationIds.includes(body.organisation_id)) { audit('selection_rejected',{reason:'foreign_organisation'}); fail(403,'selection_rejected'); return true; }
    try {
      const local=await organisationSelection.resolveOrganisation({issuer:pending.issuer,subject:pending.subject,applicationId,organisationId:body.organisation_id});
      if (!validLocal(local) || local.organisationId!==body.organisation_id) { audit('login_denied',{reason:'selection_no_longer_authorised'}); fail(403,'account_not_authorised'); return true; }
      const verified={issuer:pending.issuer,subject:pending.subject,idToken:idTokenVault?idTokenVault.open({sealed:pending.sealedIdToken,sessionId:pending.selectionHash,subject:pending.subject}):undefined};
      const cookie=await issueSession(local,verified);
      res.writeHead(303,{location:afterLogin,'cache-control':'no-store','set-cookie':[clear,cookie]});res.end();
      audit('login_succeeded',{outcome:'allow',via:'organisation_selection'});
    } catch (error) {
      audit('login_failed',{reason:error?.name==='TitanOidcLoginError'?error.message:'unexpected_error'});
      fail(401,'login_failed');
    }
    return true;
  }

  async function handle(req,res) {
    let url;
    try {url=new URL(req.url??'/', 'http://localhost');}catch{reply(res,400,{error:'invalid_url'});return true;}
    // Exact match on the raw request target: near-matches (trailing slash, case, encoded slash, dot segments) are not routes.
    const rawPath=(req.url??'/').split('?')[0];
    const routes=[expectedStart,expectedCallback,expectedSelect];
    if(!routes.includes(url.pathname)||!routes.includes(rawPath))return false;
    if(url.pathname===expectedSelect){
      if(url.search){reply(res,400,{error:'unexpected_selection_parameters'});return true;}
      return handleSelection(req,res);
    }
    if(req.method!=='GET'){reply(res,405,{error:'method_not_allowed'});return true;}
    if(url.pathname===expectedStart){
      if(url.search){reply(res,400,{error:'unexpected_login_parameters'});return true;}
      try {
        const binding=token();
        const {authorizationUrl}=await oidcLogin.begin({browserBinding:binding});
        const authUrl=new URL(authorizationUrl);
        if(!isSecureEndpoint(authUrl.href,allowInsecureLocalhost))throw Error('invalid_authorization_url');
        redirect(res,authUrl.href,buildPolicyCookie(bindingPolicy,binding,600));
      }catch(error){audit('login_begin_failed',{error_class:errorClass(error)});reply(res,503,{error:'login_unavailable'});}
      return true;
    }
    const fail=(status,reason,extra={})=>{res.writeHead(status,{'cache-control':'no-store','content-type':'application/json','set-cookie':clear,...extra});res.end(JSON.stringify({error:reason}));};
    // Per-IP limit before any state consumption or token exchange.
    const ipDecision=ipLimiter.take(clientIp(req));
    if(!ipDecision.allowed){audit('login_rate_limited',{scope:'ip'});reply(res,429,{error:'rate_limited'},{'retry-after':String(ipDecision.retryAfterSeconds)});return true;}
    if(Array.from(url.searchParams.keys()).some(k=>!['state','code','error','error_description'].includes(k)||url.searchParams.getAll(k).length!==1)) {audit('login_rejected',{reason:'invalid_callback'});fail(400,'invalid_callback');return true;}
    if(url.searchParams.has('error')) {audit('login_rejected',{reason:'identity_provider_rejected'});fail(401,'identity_provider_rejected');return true;}
    const binding=parseCookies(req)[bindingPolicy.name];
    if(!validBinding(binding)||!url.searchParams.get('code')||!url.searchParams.get('state')) {audit('login_rejected',{reason:'invalid_callback'});fail(400,'invalid_callback');return true;}
    try {
      const verified=await oidcLogin.complete({state:url.searchParams.get('state'),code:url.searchParams.get('code'),browserBinding:binding});
      // Per-subject limit once the verified subject is known. The subject is used only as an in-memory key.
      const subjectDecision=subjectLimiter.take(verified.subject);
      if(!subjectDecision.allowed){audit('login_rate_limited',{scope:'subject'});fail(429,'rate_limited',{'retry-after':String(subjectDecision.retryAfterSeconds)});return true;}
      // MUST recheck current account/membership/entitlement in the application adapter.
      const local=await resolveLocalIdentity({issuer:verified.issuer,subject:verified.subject,applicationId});
      if (local?.selectionRequired) {
        const started=await startSelection(binding,verified,local.organisationIds,sha(url.searchParams.get('state')));
        if(!started){audit('login_denied',{reason:'selection_unavailable'});fail(403,'account_not_authorised');return true;}
        audit('login_selection_required',{count:started.organisations.length});
        reply(res,200,{status:'select_organisation',organisations:started.organisations,selection_token:started.selectionToken});
        return true;
      }
      if(!validLocal(local)) {audit('login_denied',{reason:'account_not_authorised'});fail(403,'account_not_authorised');return true;}
      const cookie=await issueSession(local,verified);
      res.writeHead(303,{location:afterLogin,'cache-control':'no-store','set-cookie':[clear,cookie]});res.end();
      audit('login_succeeded',{outcome:'allow'});
    }catch(error){
      audit('login_failed',{reason:error?.name==='TitanOidcLoginError'?error.message:'unexpected_error'});
      fail(401,'login_failed');
    }
    return true;
  }

  return async function oidcHttpHandler(req,res) {
    try {return await handle(req,res);}
    catch(error){
      audit('oidc_route_failed',{error_class:errorClass(error)});
      if(!res.headersSent) reply(res,500,{error:'internal_error'});
      else try {res.end();} catch { /* socket already closed */ }
      return true;
    }
  };
}
