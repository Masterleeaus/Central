/** Pass 13: Application-owned OIDC session handoff + logout boundary.
 * Does not replace Desk/Field/Academy authentication internals. Each app injects
 * a trusted local account lookup, atomic session rotation, and revocation.
 */
const APPS = new Set(['desk', 'field', 'academy']);
const ID = /^[A-Za-z0-9:_-]{1,200}$/;
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
const cookieName = (name) => typeof name==='string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name);
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/**
 * findOrganisationIds receives the VERIFIED issuer and subject only; it must
 * consult trusted Central membership records (not a browser-selected company).
 * authorise delegates to CentralAccessService in a single read-only snapshot.
 * localAccountActive revalidates the resolved app's actual account link/role.
 * The initial login deliberately fails closed for multiple eligible organisations.
 */
export function createVerifiedIdentityResolver({applicationId, issuer, audience, findOrganisationIds, authorise, localAccountActive, clock=()=>new Date().toISOString()}={}) {
  if (!APPS.has(applicationId) || !validIssuer(issuer) || !valid(audience) ||
      typeof findOrganisationIds!=='function' || typeof authorise!=='function' || typeof localAccountActive!=='function') throw new TypeError('invalid resolver dependencies');
  return async ({issuer:verifiedIssuer, subject, applicationId:requestedApp}) => {
    if (requestedApp !== applicationId || verifiedIssuer !== issuer || !valid(subject)) return {authorised:false};
    try {
      const ids = await findOrganisationIds({issuer:verifiedIssuer,subject});
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 128 || ids.some(x=>!valid(x)) || new Set(ids).size !== ids.length) return {authorised:false};
      const decisions=[];
      for (const organisationId of ids) {
        const decision=await authorise({principal:{logtoSubject:subject,issuer:verifiedIssuer,audience,verifiedAt:clock()},organisationId,applicationId,action:'session:open'});
        if (decision?.allowed) decisions.push(decision);
      }
      if (decisions.length !== 1) return {authorised:false};
      const decision=decisions[0];
      if (decision.applicationId!==applicationId || !ids.includes(decision.organisationId) || !valid(decision.localUserId) || !valid(decision.localAccountId)) return {authorised:false};
      if (!await localAccountActive({applicationId,organisationId:decision.organisationId,localUserId:decision.localUserId,localAccountId:decision.localAccountId})) return {authorised:false};
      return {authorised:true,localUserId:decision.localUserId,localAccountId:decision.localAccountId,organisationId:decision.organisationId};
    } catch { return {authorised:false}; }
  };
}

/**
 * rotateAppSession MUST invalidate previous session and create a fresh random
 * server-stored revocable session (not a JWT copied between applications).
 * It receives app-owned local identities only after the resolver's checks.
 */
export function createAppSessionIssuer({applicationId,rotateAppSession,sessionCookieName,sessionTtlSeconds=3600}={}) {
  if (!APPS.has(applicationId)||typeof rotateAppSession!=='function'||!cookieName(sessionCookieName)||!Number.isInteger(sessionTtlSeconds)||sessionTtlSeconds<60||sessionTtlSeconds>86400) throw new TypeError('invalid issuer dependencies');
  return async ({applicationId:app,localUserId,localAccountId,organisationId,oidcSubject,oidcIssuer}) => {
    if (app!==applicationId||!valid(localUserId)||!valid(localAccountId)||!valid(organisationId)||!valid(oidcSubject)||!validIssuer(oidcIssuer)) throw Error('invalid identity');
    const session=await rotateAppSession({localUserId,localAccountId,organisationId,oidcSubject,oidcIssuer,applicationId});
    if(typeof session!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(session)) throw Error('session rotation unavailable');
    return cookie(sessionCookieName,session,sessionTtlSeconds);
  };
}

/**
 * Local logout is a same-origin POST with app-owned session authentication and
 * revocation. Central/Logto global logout requires a separate RP-initiated flow.
 * Deliberately rejects GET logout to avoid CSRF and unwanted sign-outs.
 */
export function createAppLogoutHandler({applicationId,appOrigin,sessionCookieName,authenticateSession,revokeSession,logger=()=>{}}={}) {
  if (!APPS.has(applicationId)||typeof authenticateSession!=='function'||typeof revokeSession!=='function'||!cookieName(sessionCookieName)) throw new TypeError('invalid logout dependencies');
  const origin=originOf(appOrigin);
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
      res.writeHead(204,{'cache-control':'no-store','set-cookie':cookie(sessionCookieName,'',0)});res.end();
    } catch (error) {logger('app_logout_failed',error);response(res,503,'logout_unavailable');}
    return true;
  };
}
