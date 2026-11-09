import {fail} from './errors.mjs';
export function createJwksProvider({issuer,jwksUri,fetcher=fetch,clock=Date.now,ttlMs=300000}={}) {
 if(typeof issuer!=='string'||!issuer.startsWith('https://')||typeof fetcher!=='function'||!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>3600000)fail('invalid_jwks');
 let uri;
 try { const endpoint=new URL(jwksUri);const source=new URL(issuer);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.origin!==source.origin)fail('invalid_jwks_uri');uri=endpoint.href; }catch{fail('invalid_jwks_uri');}
 let cache=null,expiry=0,pending=null;
 async function refresh(){
  const response=await fetcher(uri,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok)fail('jwks_unavailable');
  const data=await response.json();
  if(!Array.isArray(data?.keys)||data.keys.length>32)fail('invalid_jwks');
  cache=data.keys.filter(k=>k&&k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256'&&typeof k.kid==='string');
  expiry=clock()+ttlMs;return cache;
 }
 return async function getKey(kid){
  if(typeof kid!=='string'||!(/^[A-Za-z0-9._-]{1,128}$/).test(kid))fail('unauthorised');
  const keys=cache&&clock()<expiry?cache:await (pending??(pending=refresh().finally(()=>pending=null)));
  const matches=keys.filter(k=>k.kid===kid);
  if(matches.length!==1)fail('unauthorised');
  return matches[0];
 };
}
