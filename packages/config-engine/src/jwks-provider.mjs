import {fail} from './errors.mjs';
import {jwksRefreshPolicy,assertJwksKeySet} from './jwks-refresh-policy.mjs';
export function createJwksProvider({issuer,jwksUri,fetcher=fetch,clock=Date.now,ttlMs=300000,unknownKidCooldownMs=3000}={}){
 const policy=jwksRefreshPolicy({ttlMs,unknownKidCooldownMs});
 if(typeof issuer!=='string'||!issuer.startsWith('https://')||typeof fetcher!=='function'||typeof clock!=='function')fail('invalid_jwks');
 let uri;
 try{
  const endpoint=new URL(jwksUri),source=new URL(issuer);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
     endpoint.origin!==source.origin)fail('invalid_jwks_uri');
  uri=endpoint.href;
 }catch{fail('invalid_jwks_uri')}
 let keys=null,expiresAt=0,pending=null,nextUnknownRefresh=0;
 async function refresh(){
  const response=await fetcher(uri,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(4000)});
  if(!response?.ok)fail('jwks_unavailable');
  const data=await response.json(),fresh=assertJwksKeySet(data?.keys);
  keys=fresh;expiresAt=clock()+policy.ttlMs;
  return keys;
 }
 const fetchOnce=()=>pending??(pending=refresh().finally(()=>{pending=null}));
 return async function keyFor(kid){
  if(typeof kid!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(kid))fail('unauthorised');
  const time=clock();
  let list=keys&&time<expiresAt?keys:await fetchOnce();
  let matches=list.filter(k=>k.kid===kid);
  if(matches.length===0&&time>=nextUnknownRefresh){
   nextUnknownRefresh=time+policy.unknownKidCooldownMs;
   list=await fetchOnce();
   matches=list.filter(k=>k.kid===kid);
  }
  if(matches.length!==1)fail('unauthorised');
  return matches[0];
 };
}
