import {createPublicKey,verify as verifySig} from 'node:crypto';
import {readBearer} from './bearer.mjs';
import {jwtParts} from './jwt-parts.mjs';
import {issuerPolicy,assertClaims} from './issuer-policy.mjs';
import {createJwksProvider} from './jwks-provider.mjs';
import {fail} from './errors.mjs';
export function createServiceJwtVerifier({issuer,audience,jwksUri,fetcher,clock=Date.now}={}) {
 const policy=issuerPolicy({issuer,audience});
 const keyFor=createJwksProvider({issuer,jwksUri,fetcher,clock});
 return async function authenticate(authorization){
  const token=readBearer(authorization),{header,claims,signature,signingInput}=jwtParts(token);
  if(header.alg!=='RS256'||header.typ && header.typ!=='JWT'||typeof header.kid!=='string'||header.jku||header.jwk||header.x5u||header.crit||header.b64===false)fail('unauthorised');
  const jwk=await keyFor(header.kid);
  let valid=false;
  try{valid=verifySig('RSA-SHA256',Buffer.from(signingInput),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(signature,'base64url'))}catch{}
  if(!valid)fail('unauthorised');
  assertClaims(claims,policy,Math.floor(clock()/1000));
  // A signed token proves the client identity, NOT company membership.
  // Registry lookup determines products and authorised company independently.
  const clientId=claims.client_id??claims.azp;
  if(typeof clientId!=='string'||!(/^[a-zA-Z0-9:_-]{1,256}$/).test(clientId))fail('unauthorised');
  return Object.freeze({authenticated:true,kind:'service',clientId,subject:claims.sub});
 };
}
