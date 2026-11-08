/** Fixed-issuer RS256 OpenID Connect ID token validation for the login callback.
 * Unlike an access-token verifier, returns only verified identity claims. */
import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {TitanOidcLoginError} from './oidc-login.mjs';
const parse = part => {try{return JSON.parse(Buffer.from(part,'base64url').toString('utf8'));}catch{throw new TitanOidcLoginError('invalid_identity_token');}};
const fail=()=>{throw new TitanOidcLoginError('invalid_identity_token');};
export function createIdTokenVerifier({issuer,clientId,jwksUri,fetcher=fetch,clock=()=>Date.now(),maxAgeMs=300_000}={}) {
  for(const endpoint of [issuer,jwksUri]){
    if(typeof endpoint!=='string')throw new TypeError('OIDC endpoint required');
    const u=new URL(endpoint);
    if(u.username||u.password||u.hash||u.search||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='localhost')))throw new TypeError('insecure OIDC endpoint');
  }
  if(typeof clientId!=='string'||!clientId||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>900_000)throw new TypeError('invalid OIDC verifier configuration');
  let keys=[],expires=0;
  async function getKeys(force=false) {
    if(!force && clock()<expires)return keys;
    let response,doc;
    try{response=await fetcher(jwksUri,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(4000)});if(!response.ok)fail();doc=await response.json();}catch{fail();}
    if(!Array.isArray(doc?.keys)||doc.keys.length>64)fail();
    keys=doc.keys.filter(k=>k?.kty==='RSA'&&typeof k.kid==='string'&&k.kid&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
    expires=clock()+60_000;
    return keys;
  }
  return async function verifyIdToken(token) {
    if(typeof token!=='string'||token.length>16384)fail();
    const parts=token.split('.');if(parts.length!==3)fail();
    const [h,p,s]=parts,header=parse(h),payload=parse(p);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.crit||header.jku||header.x5u||header.b64===false)fail();
    let key=(await getKeys()).find(k=>k.kid===header.kid);
    if(!key)key=(await getKeys(true)).find(k=>k.kid===header.kid);
    if(!key)fail();
    try {if(!verifySignature('RSA-SHA256',Buffer.from(`${h}.${p}`),createPublicKey({key,format:'jwk'}),Buffer.from(s,'base64url')))fail();}catch{fail();}
    const now=Math.floor(clock()/1000);
    const aud=payload.aud;
    if(payload.iss!==issuer|| !(aud===clientId||(Array.isArray(aud)&&aud.includes(clientId))) || (Array.isArray(aud)&&aud.length>1&&payload.azp!==clientId) || (payload.azp&&payload.azp!==clientId) || typeof payload.sub!=='string'||!payload.sub || typeof payload.nonce!=='string'||!payload.nonce ||!Number.isSafeInteger(payload.iat)||payload.iat>now+60||payload.iat<now-Math.ceil(maxAgeMs/1000)-60||!Number.isSafeInteger(payload.exp)||payload.exp<=now || (payload.nbf!==undefined&&(!Number.isSafeInteger(payload.nbf)||payload.nbf>now+60)))fail();
    return {iss:payload.iss,aud:payload.aud,sub:payload.sub,nonce:payload.nonce,exp:payload.exp,iat:payload.iat,azp:payload.azp};
  };
}
