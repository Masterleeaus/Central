/** Server-side product-owned account proof signer.
 * Mount only in the product that actually owns the local account. It must
 * authenticate the local account from its own session and verify the exact
 * Central identity + company mapping independently. This module NEVER
 * accepts an email address, browser account claim, or an arbitrary product
 * supplied in the request as proof.
 */
import {createPrivateKey,createPublicKey,randomBytes,sign} from 'node:crypto';
import {stableJson,validateProductLinkClaims} from './product-link-proof.mjs';
const APPS=new Set(['field','desk','academy']);
export function createProductAccountProofIssuer({applicationId,privateKey,
 verifyAccountControl,clock=()=>Date.now(),randomNonce=()=>randomBytes(32).toString('base64url')}={}){
 if(!APPS.has(applicationId)||typeof verifyAccountControl!=='function'||
  typeof clock!=='function'||typeof randomNonce!=='function')
  throw TypeError('trusted product account proof issuer required');
 const key=createPrivateKey(privateKey);
 if(key.asymmetricKeyType!=='ed25519')throw TypeError('product signing key must be Ed25519');
 const publicKey=createPublicKey(key).export({format:'pem',type:'spki'});
 return Object.freeze({
  publicKey,
  async issue({identityId,organisationId,localUserId,localAccountId}={}){
   const now=clock();
   if(!Number.isSafeInteger(now))throw Error('invalid product clock');
   const claims={
    schema:'titan.product-account-control.v1',applicationId,
    identityId,organisationId,localUserId,localAccountId,
    nonce:randomNonce(),
    issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60_000).toISOString(),
    action:'link'
   };
   validateProductLinkClaims(claims,now);
   const approved=await verifyAccountControl({
    applicationId,identityId,organisationId,localUserId,localAccountId});
   if(approved!==true)throw Error('product account control not verified');
   const signature=sign(null,Buffer.from('titan:product-account-control:v1\n'+stableJson(claims)),key);
   return {claims,signature:signature.toString('base64')};
  }
 });
}
