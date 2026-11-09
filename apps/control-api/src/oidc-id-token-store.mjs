/** Encrypted storage of the sign-in ID token, so RP-initiated logout can send id_token_hint (issue #6).
 * The token is sealed with AES-256-GCM (oidc-state-crypto.mjs) under a subkey derived with HKDF-SHA256
 * from TITAN_OIDC_STATE_KEY. The AAD binds each sealed token to application, session id and subject, so a
 * sealed value moved to another session or subject fails to open. There is no default key: construction
 * throws when TITAN_OIDC_STATE_KEY is missing or malformed (fail closed).
 *
 * Storage is injected by each application: the application's own session store keeps the sealed value
 * next to the session row. This module never writes to a database and never logs the token. */
import {hkdfSync} from 'node:crypto';
import {createStateSealer,parseStateKey,STATE_KEY_ENV} from './oidc-state-crypto.mjs';

const APPS=new Set(['desk','field','academy']);
const SESSION_ID=/^[A-Za-z0-9_-]{8,256}$/;
const SUBJECT=/^[A-Za-z0-9:_-]{1,200}$/;
const ID_TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const MAX_ID_TOKEN=16384;
const ORGANISATION=/^[A-Za-z0-9:_-]{1,200}$/;
const SUBKEY_INFO='titan.oidc.id_token.v1';

/** Derives the ID-token subkey from the state key so the two uses never share a key. */
export function deriveIdTokenKey(stateKey){
  return Buffer.from(hkdfSync('sha256',stateKey,Buffer.alloc(0),SUBKEY_INFO,32));
}

const aadFor=(applicationId,sessionId,subject)=>`titan_oidc_id_token|${applicationId}|${sessionId}|${subject}`;

/** Vault for one application. Reads TITAN_OIDC_STATE_KEY from env; throws if it is absent or malformed. */
export function createIdTokenVault({applicationId,env=process.env}={}){
  if(!APPS.has(applicationId))throw new TypeError('invalid id token vault application');
  const sealer=createStateSealer({key:deriveIdTokenKey(parseStateKey(env[STATE_KEY_ENV]))});
  const checkBinding=(sessionId,subject)=>{
    if(typeof sessionId!=='string'||!SESSION_ID.test(sessionId))throw new TypeError('invalid id token session binding');
    if(typeof subject!=='string'||!SUBJECT.test(subject))throw new TypeError('invalid id token subject binding');
  };
  return Object.freeze({
    /** Seals an ID token for one session and subject. Returns an opaque string safe to store. */
    seal({idToken,sessionId,subject}={}){
      checkBinding(sessionId,subject);
      if(typeof idToken!=='string'||idToken.length>MAX_ID_TOKEN||!ID_TOKEN.test(idToken))throw new TypeError('invalid id token');
      return sealer.seal(idToken,aadFor(applicationId,sessionId,subject));
    },
    /** Opens a sealed token for the given session and subject. Throws on any mismatch or tampering. */
    open({sealed,sessionId,subject}={}){
      checkBinding(sessionId,subject);
      const token=sealer.open(sealed,aadFor(applicationId,sessionId,subject));
      if(token.length>MAX_ID_TOKEN||!ID_TOKEN.test(token))throw new Error('sealed value rejected');
      return token;
    }
  });
}

/**
 * Builds authenticateSession for createGlobalLogoutHandler.
 * loadSession(req) is app-owned: it reads the caller's session cookie, looks up the server-side session and
 * resolves to {sessionId, logtoSubject, scopes, sealedIdToken}, or null. Scopes must all belong to the
 * caller's own subject, so a session can never revoke another user's sessions.
 * Every failure (no session, bad seal, wrong binding, foreign scope) resolves to null, which the route answers with 401.
 */
export function createLogoutSessionAuthenticator({applicationId,vault,loadSession}={}){
  if(!APPS.has(applicationId)||typeof vault?.open!=='function'||typeof loadSession!=='function')throw new TypeError('invalid logout authenticator');
  return async function authenticateSession(req){
    try{
      const session=await loadSession(req);
      if(!session||typeof session.sessionId!=='string'||typeof session.logtoSubject!=='string'||!Array.isArray(session.scopes)||session.scopes.length<1)return null;
      if(!session.scopes.every(scope=>scope?.logtoSubject===session.logtoSubject&&typeof scope.organisationId==='string'&&ORGANISATION.test(scope.organisationId)))return null;
      const idTokenHint=vault.open({sealed:session.sealedIdToken,sessionId:session.sessionId,subject:session.logtoSubject});
      return {idTokenHint,scopes:session.scopes.map(scope=>({logtoSubject:scope.logtoSubject,organisationId:scope.organisationId}))};
    }catch{return null;}
  };
}
