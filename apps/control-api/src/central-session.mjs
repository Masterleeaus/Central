/**
 * Central-owned opaque browser sessions. This is not an OIDC token or product
 * session; the caller must complete verified OIDC authentication and company
 * selection before issuing one. A durable, atomic session store is required.
 */
import {randomBytes,createHash} from 'node:crypto';

export const CENTRAL_COOKIE='__Host-titan-central';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SUBJECT=/^[^\s\x00-\x1f\x7f]{1,256}$/u;
const MAX_AGE=8*60*60;
const digest=value=>createHash('sha256').update(value).digest('hex');
export const sessionCookie=(token,maxAge=MAX_AGE)=>{
  if(token!==''&&!TOKEN.test(token))throw new TypeError('invalid opaque session token');
  if(!Number.isSafeInteger(maxAge)||maxAge<0||maxAge>MAX_AGE)throw new TypeError('invalid session lifetime');
  return `${CENTRAL_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
};
export const clearSessionCookie=()=>sessionCookie('',0);

/** Reject duplicate cookies, oversized headers, malformed values, and
 * ambiguous cookie pairs. Never read a domain-scoped product cookie. */
export function readSessionCookie(req){
  const raw=req?.headers?.cookie;
  if(typeof raw!=='string'||raw.length>8192)return null;
  let found=null;
  for(const entry of raw.split(';')){
    const part=entry.trim();
    const idx=part.indexOf('=');
    if(idx<1)continue;
    if(part.slice(0,idx)!==CENTRAL_COOKIE)continue;
    if(found!==null)return null;
    const token=part.slice(idx+1);
    if(!TOKEN.test(token))return null;
    found=token;
  }
  return found;
}
const validIdentity=x=>typeof x==='string'&&SUBJECT.test(x);
const validCompany=x=>typeof x==='string'&&UUID.test(x);
const safeRecord=(record,now)=>{
  if(!record||!validIdentity(record.identityId)||!validCompany(record.companyId)||
    !Number.isSafeInteger(record.expiresAt)||record.expiresAt<=now||
    record.expiresAt>now+MAX_AGE*1000||record.revoked===true)return null;
  return {identityId:record.identityId,companyId:record.companyId};
};
/**
 * Store contract:
 * insert({digest,identityId,companyId,expiresAt}) atomic, unique digest;
 * find(digest) reads authoritative expiry/revocation (not cached in browser);
 * delete(digest) idempotent, including from competing workers.
 * Backed by durable shared storage when deployed.
 */
export function createCentralSessionManager({store,clock=()=>Date.now(),random=()=>randomBytes(32).toString('base64url')}={}){
  if(!store||typeof store.insert!=='function'||typeof store.find!=='function'||typeof store.delete!=='function'||typeof clock!=='function'||typeof random!=='function')throw new TypeError('durable session store required');
  return Object.freeze({
    async issue({identityId,companyId}){
      if(!validIdentity(identityId)||!validCompany(companyId))throw new TypeError('verified identity and company required');
      const token=random();
      if(!TOKEN.test(token))throw new TypeError('invalid token generator');
      const expiresAt=clock()+MAX_AGE*1000;
      await store.insert({digest:digest(token),identityId,companyId,expiresAt});
      return {cookie:sessionCookie(token),expiresAt};
    },
    async resolve(req){
      const token=readSessionCookie(req);
      if(!token)return null;
      const now=clock();
      const record=await store.find(digest(token));
      return safeRecord(record,now);
    },
    async revoke(req){
      const token=readSessionCookie(req);
      if(token)await store.delete(digest(token));
      return clearSessionCookie();
    },
    /** Company switching rotates the token; never edits old session in place.
     * A failed old-session revocation fails the operation; caller must not send
     * the replacement cookie. The unissued replacement must also be revoked. */
    async rotate(req,{identityId,companyId}){
      const old=readSessionCookie(req);
      if(!old)throw new Error('session required');
      if(!validIdentity(identityId)||!validCompany(companyId))throw new TypeError('verified identity and company required');
      const existing=safeRecord(await store.find(digest(old)),clock());
      if(!existing||existing.identityId!==identityId)throw new Error('session not authorised');
      if(existing.companyId.toLowerCase()===companyId.toLowerCase())throw new Error('company switch must change company');
      const next=random();
      if(!TOKEN.test(next)||next===old)throw new TypeError('invalid replacement token');
      const expiresAt=clock()+MAX_AGE*1000;
      const nextDigest=digest(next);
      await store.insert({digest:nextDigest,identityId,companyId,expiresAt});
      try {
        const deleted=await store.delete(digest(old));
        if(deleted!==true)throw new Error('previous session already consumed');
      } catch(error){
        try {await store.delete(nextDigest);}catch{/* fail closed; do not send new cookie */}
        throw error;
      }
      return {cookie:sessionCookie(next),expiresAt};
    }
  });
}
