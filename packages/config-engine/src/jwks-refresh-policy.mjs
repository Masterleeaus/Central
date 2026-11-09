import {fail} from './errors.mjs';
export function jwksRefreshPolicy({ttlMs=300000,unknownKidCooldownMs=3000}={}){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>3600000||
 !Number.isSafeInteger(unknownKidCooldownMs)||unknownKidCooldownMs<1000||unknownKidCooldownMs>60000)
 fail('invalid_jwks');
 return Object.freeze({ttlMs,unknownKidCooldownMs});
}
export function assertJwksKeySet(keys){
 if(!Array.isArray(keys)||keys.length>32)fail('invalid_jwks');
 const approved=keys.filter(k=>k&&k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256'&&
  typeof k.kid==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(k.kid)&&
  typeof k.n==='string'&&typeof k.e==='string');
 if(new Set(approved.map(k=>k.kid)).size!==approved.length)fail('invalid_jwks');
 return approved;
}
