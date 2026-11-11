/** Pass 13: Application-owned OIDC session handoff + logout boundary.
 * Does not replace Desk/Field/Academy authentication internals. Each app injects
 * a trusted local account lookup, atomic session rotation, and revocation.
 */
import { appSessionCookiePolicy, buildPolicyCookie, buildClearCookie } from './oidc-cookie-policy.mjs';

const APPS = new Set(['desk', 'field', 'academy']);
const ID = /^[A-Za-z0-9:_-]{1,200}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{8,256}$/;
const valid = (v) => typeof v === 'string' && ID.test(v);
const validIssuer = value => {try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.origin===value;}catch{return false;}};
const response = (res, code, error) => {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify({error}));
};
const originOf = (value) => {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('invalid app origin');
  return u.origin;
};
// The session cookie name is fixed by policy (`${applicationId}_sid`); callers cannot choose another.
const sessionNameFor = (applicationId, name) => APPS.has(applicationId) && name === appSessionCookiePolicy(applicationId).name;
const validLocal = (decision, organisationId) => decision && valid(decision.localUserId) && valid(decision.localAccountId) && (organisationId===undefined || decision.organisationId===organisationId);

/**
 * findOrganisationIds receives the VERIFIED issuer and subject only; it must
 * consult trusted Central membership records (not a browser-selected company).
 * authorise delegates to CentralAccessService in a single read-only snapshot.
 * localAccountActive revalidates the resolved app's actual account link/role.
 *
 * Result of the returned resolver (called as resolver({issuer, subject, applicationId})):
 * - {authorised:true, localUserId, localAccountId, organisationId}: exactly one organisation is eligible.
 * - {authorised:false, selectionRequired:true, organisationIds}: several organisations are eligible.
 *   organisationIds lists ONLY organisations returned by findOrganisationIds that passed authorise and
 *   localAccountActive. The adapter then asks the user to choose one and calls resolveOrganisation.
 * - {authorised:false}: everything else, including any mismatched decision (fail closed).
 * The resolver also carries resolver.resolveOrganisation({issuer, subject, applicationId, organisationId}),
 * which repeats every check for ONE organisation against a fresh membership lookup. Use it before rotating a session.
 */
export function createVerifiedIdentityResolver({applicationId, issuer, audience, findOrganisationIds, authorise, localAccountActive, clock=()=>new Date().toISOString()}={}) {
  if (!APPS.has(applicationId) || !validIssuer(issuer) || !valid(audience) ||
      typeof findOrganisationIds!=='function' || typeof authorise!=='function' || typeof localAccountActive!=='function') throw new TypeError('invalid resolver dependencies');
  const principalFor = (subject, verifiedIssuer) => ({logtoSubject:subject,issuer:verifiedIssuer,audience,verifiedAt:clock()});

  async function resolveIdentity({issuer:verifiedIssuer, subject, applicationId:requestedApp, organisationId:selectedOrganisationId}) {
    if(selectedOrganisationId!==undefined)return resolveOrganisation({issuer:verifiedIssuer,subject,applicationId:requestedApp,organisationId:selectedOrganisationId});
    if (requestedApp !== applicationId || verifiedIssuer !== issuer || !valid(subject)) return {authorised:false};
    try {
      const ids = await findOrganisationIds({issuer:verifiedIssuer,subject});
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 128 || ids.some(x=>!valid(x)) || new Set(ids).size !== ids.length) return {authorised:false};
      const eligible = [];
      for (const organisationId of ids) {
        const decision = await authorise({principal:principalFor(subject,verifiedIssuer),organisationId,applicationId,action:'session:open'});
        if (!decision?.allowed) continue;
        // A decision for another application or organisation is never trusted: refuse the whole sign-in.
        if (decision.applicationId!==applicationId || decision.organisationId!==organisationId || !validLocal(decision)) return {authorised:false};
        if (!await localAccountActive({applicationId,organisationId,localUserId:decision.localUserId,localAccountId:decision.localAccountId})) continue;
        eligible.push({organisationId,localUserId:decision.localUserId,localAccountId:decision.localAccountId});
      }
      if (eligible.length === 0) return {authorised:false};
      if (eligible.length > 1) return {authorised:false,selectionRequired:true,organisationIds:eligible.map(e=>e.organisationId)};
      const [only] = eligible;
      return {authorised:true,localUserId:only.localUserId,localAccountId:only.localAccountId,organisationId:only.organisationId};
    } catch { return {authorised:false}; }
  }

  /** Re-verifies one organisation immediately before a session is rotated: membership, entitlement and local account. */
  async function resolveOrganisation({issuer:verifiedIssuer, subject, applicationId:requestedApp, organisationId}) {
    if (requestedApp !== applicationId || verifiedIssuer !== issuer || !valid(subject) || !valid(organisationId)) return {authorised:false};
    try {
      const ids = await findOrganisationIds({issuer:verifiedIssuer,subject});
      if (!Array.isArray(ids) || !ids.includes(organisationId)) return {authorised:false};
      const decision = await authorise({principal:principalFor(subject,verifiedIssuer),organisationId,applicationId,action:'session:open'});
      if (!decision?.allowed || decision.applicationId!==applicationId || !validLocal(decision, organisationId)) return {authorised:false};
      if (!await localAccountActive({applicationId,organisationId,localUserId:decision.localUserId,localAccountId:decision.localAccountId})) return {authorised:false};
      return {authorised:true,localUserId:decision.localUserId,localAccountId:decision.localAccountId,organisationId};
    } catch { return {authorised:false}; }
  }

  resolveIdentity.resolveOrganisation = resolveOrganisation;
  return resolveIdentity;
}

/**
 * rotateAppSession MUST invalidate previous session and create a fresh random
 * server-stored revocable session (not a JWT copied between applications).
 * It receives app-owned local identities only after the resolver's checks.
 */
export function createAppSessionIssuer({applicationId,rotateAppSession,sessionCookieName,sessionTtlSeconds=3600}={}) {
  if (!APPS.has(applicationId)||typeof rotateAppSession!=='function'||!sessionNameFor(applicationId,sessionCookieName)||!Number.isInteger(sessionTtlSeconds)||sessionTtlSeconds<60||sessionTtlSeconds>86400) throw new TypeError('invalid issuer dependencies');
  const policy=appSessionCookiePolicy(applicationId);
  return async ({applicationId:app,localUserId,localAccountId,organisationId,oidcSubject,oidcIssuer}) => {
    if (app!==applicationId||!valid(localUserId)||!valid(localAccountId)||!valid(organisationId)||!valid(oidcSubject)||!validIssuer(oidcIssuer)) throw Error('invalid identity');
    const session=await rotateAppSession({localUserId,localAccountId,organisationId,oidcSubject,oidcIssuer,applicationId});
    if(typeof session!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(session)) throw Error('session rotation unavailable');
    return buildPolicyCookie(policy,session,sessionTtlSeconds);
  };
}

/**
 * Same checks as createAppSessionIssuer, but rotateAppSession resolves {token, sessionId} and the
 * establisher returns {cookie, sessionId}. The server-side sessionId is what the adapter binds the
 * sealed ID token to (oidc-id-token-store.mjs). The token itself is never used as an identifier.
 */
export function createAppSessionEstablisher({applicationId,rotateAppSession,sessionCookieName,sessionTtlSeconds=3600}={}) {
  if (!APPS.has(applicationId)||typeof rotateAppSession!=='function'||!sessionNameFor(applicationId,sessionCookieName)||!Number.isInteger(sessionTtlSeconds)||sessionTtlSeconds<60||sessionTtlSeconds>86400) throw new TypeError('invalid establisher dependencies');
  const policy=appSessionCookiePolicy(applicationId);
  return async ({applicationId:app,localUserId,localAccountId,organisationId,oidcSubject,oidcIssuer}) => {
    if (app!==applicationId||!valid(localUserId)||!valid(localAccountId)||!valid(organisationId)||!valid(oidcSubject)||!validIssuer(oidcIssuer)) throw Error('invalid identity');
    const rotated=await rotateAppSession({localUserId,localAccountId,organisationId,oidcSubject,oidcIssuer,applicationId});
    if(!rotated||typeof rotated.token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(rotated.token)||typeof rotated.sessionId!=='string'||!SESSION_ID.test(rotated.sessionId)) throw Error('session rotation unavailable');
    return {cookie:buildPolicyCookie(policy,rotated.token,sessionTtlSeconds),sessionId:rotated.sessionId};
  };
}

/**
 * Local logout is a same-origin POST with app-owned session authentication and
 * revocation. Central/Logto global logout requires a separate RP-initiated flow.
 * Deliberately rejects GET logout to avoid CSRF and unwanted sign-outs.
 */
export function createAppLogoutHandler({applicationId,appOrigin,sessionCookieName,authenticateSession,revokeSession,logger=()=>{}}={}) {
  if (!APPS.has(applicationId)||typeof authenticateSession!=='function'||typeof revokeSession!=='function'||!sessionNameFor(applicationId,sessionCookieName)) throw new TypeError('invalid logout dependencies');
  const origin=originOf(appOrigin);
  const clear=buildClearCookie(appSessionCookiePolicy(applicationId));
  return async (req,res) => {
    if (new URL(req.url??'/',origin).pathname !== `/auth/titan/${applicationId}/logout`) return false;
    if(req.method!=='POST') {response(res,405,'method_not_allowed');return true;}
    // Both headers are required: a missing Origin or Sec-Fetch-Site is denied, never defaulted.
    const site=req.headers?.['sec-fetch-site'];
    if (typeof req.headers?.origin!=='string' || req.headers.origin!==origin || typeof site!=='string' || !['same-origin','none'].includes(site)) {response(res,403,'origin_denied');return true;}
    try {
      const session = await authenticateSession(req);
      if (!session || !valid(session.id) || !valid(session.userId)) {response(res,401,'unauthenticated');return true;}
      const revoked = await revokeSession({sessionId:session.id,userId:session.userId,applicationId});
      if(revoked!==true) throw Error('revocation_not_confirmed');
      res.writeHead(204,{'cache-control':'no-store','set-cookie':clear});res.end();
    } catch (error) {logger('app_logout_failed',error);response(res,503,'logout_unavailable');}
    return true;
  };
}
