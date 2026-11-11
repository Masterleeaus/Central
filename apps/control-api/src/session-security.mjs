/** Pass 14: application-session authorization recheck and versioned revocation.
 * App servers MUST invoke this before serving a protected request. Does not
 * accept tenant/user/role context from client headers or query parameters.
 */
const APP_IDS = new Set(['desk','field','academy']);
const ID = /^[A-Za-z0-9:_-]{1,200}$/;
const valid = value => typeof value === 'string' && ID.test(value);
const deny = reason => ({allowed:false,reason});

/**
 * loadSession is an app-owned session store lookup; it MUST return stored,
 * authenticated localUserId / localAccountId / organisationId and Logto subject.
 * readVersion is a Central-owned monotonic revocation generation (default 0).
 * checkAccess must verify current membership, entitlement and verified app link.
 * checkLocalAccount confirms app-owned account and user are still active.
 * No remote caller is allowed to supply the session's account binding.
 */
export function createProtectedSessionGuard({applicationId,loadSession,readVersion,checkAccess,checkLocalAccount,clock=()=>Date.now()}={}) {
  if(!APP_IDS.has(applicationId)||![loadSession,readVersion,checkAccess,checkLocalAccount].every(f=>typeof f==='function')||typeof clock!=='function')throw new TypeError('invalid session guard dependencies');
  return async ({sessionId,requestedOrganisationId}={}) => {
    if(!valid(sessionId))return deny('invalid_session');
    try {
      const session=await loadSession({applicationId,sessionId});
      if(!session || ![session.localUserId,session.localAccountId,session.organisationId,session.logtoSubject].every(valid) || session.applicationId!==applicationId || !Number.isSafeInteger(session.generation)||session.generation<0 || !Number.isFinite(session.expiresAt) || session.expiresAt<=clock())return deny('session_invalid');
      if(requestedOrganisationId!==undefined && requestedOrganisationId!==session.organisationId)return deny('tenant_mismatch');
      const generation=await readVersion({applicationId,logtoSubject:session.logtoSubject,organisationId:session.organisationId});
      if(!Number.isSafeInteger(generation)||generation!==session.generation)return deny('session_revoked');
      const authority=await checkAccess({applicationId,logtoSubject:session.logtoSubject,organisationId:session.organisationId,localUserId:session.localUserId,localAccountId:session.localAccountId,action:'session:continue'});
      if(authority?.allowed!==true || authority.applicationId!==applicationId || authority.organisationId!==session.organisationId || authority.localUserId!==session.localUserId || authority.localAccountId!==session.localAccountId)return deny('access_revoked');
      if(await checkLocalAccount({applicationId,localUserId:session.localUserId,localAccountId:session.localAccountId,organisationId:session.organisationId})!==true)return deny('local_account_inactive');
      // Sensitive business IDs are returned from the trusted session, not request input.
      return {allowed:true,applicationId,organisationId:session.organisationId,localAccountId:session.localAccountId,localUserId:session.localUserId};
    } catch {return deny('verification_unavailable');}
  };
}
/** An account switch must revoke/rotate the old application session and repeat
 * full authorisation, rather than mutate an existing cookie's tenant context. */
export function createAccountSwitcher({applicationId,revokeOldSession,issueNewSession,authoriseTarget}={}) {
  if(!APP_IDS.has(applicationId)||![revokeOldSession,issueNewSession,authoriseTarget].every(f=>typeof f==='function'))throw new TypeError('invalid account switcher');
  return async ({sessionId,targetOrganisationId}={})=>{
    if(!valid(sessionId)||!valid(targetOrganisationId))return {switched:false};
    try {
      const target=await authoriseTarget({applicationId,sessionId,organisationId:targetOrganisationId});
      if(!target?.authorised || target.organisationId!==targetOrganisationId || target.applicationId!==applicationId || !valid(target.localUserId)||!valid(target.localAccountId))return {switched:false};
      // Revoke before issuing: failure cannot leave two sessions with different tenants.
      if(await revokeOldSession({applicationId,sessionId})!==true)return {switched:false};
      const newSession=await issueNewSession({applicationId,organisationId:targetOrganisationId,localUserId:target.localUserId,localAccountId:target.localAccountId});
      if(typeof newSession!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(newSession))return {switched:false};
      return {switched:true,newSession};
    }catch{return {switched:false};}
  };
}
