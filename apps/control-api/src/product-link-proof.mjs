/** Signed product-owned account proof for an explicitly authorised Central link.
 *
 * A proof is a short-lived Ed25519 assertion signed by the destination
 * product's independently provisioned key. Never trust email, names, a
 * browser-submitted subject or the embedded key as evidence of ownership.
 * After signature and claim validation the nonce MUST be claimed atomically
 * by a durable independent store before a caller authorises provisioning.
 *
 * Product IDs here are legacy wire identifiers pending separate migration:
 * field=Sorted, desk=Supercharged, academy=LMS.
 */
import {createHash,createPublicKey,KeyObject,verify as verifySignature,timingSafeEqual} from 'node:crypto';
const APPS=new Set(['field','desk','academy']);
const ID=/^[a-zA-Z0-9:_-]{1,200}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const NONCE=/^[a-zA-Z0-9_-]{32,128}$/;
const BASE64=/^[A-Za-z0-9+/]{86}==$/;
const FIELDS=['schema','applicationId','identityId','organisationId','localUserId','localAccountId','nonce','issuedAt','expiresAt','action'];
const PROOF_FIELDS=['claims','signature'];
export const stableJson=value=>Array.isArray(value)?'['+value.map(stableJson).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableJson(value[k])).join(',')+'}':JSON.stringify(value);
const exact=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
const validTime=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&
 Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function validateProductLinkClaims(claims,now=Date.now()){
 if(!exact(claims,FIELDS)||claims.schema!=='titan.product-account-control.v1'||
   !APPS.has(claims.applicationId)||!UUID.test(claims.identityId)||
   !UUID.test(claims.organisationId)||!ID.test(claims.localUserId)||
   !ID.test(claims.localAccountId)||!NONCE.test(claims.nonce)||
   claims.action!=='link'||!validTime(claims.issuedAt)||
   !validTime(claims.expiresAt)||!Number.isSafeInteger(now))
   throw Error('invalid product account proof');
 const issued=Date.parse(claims.issuedAt),expires=Date.parse(claims.expiresAt);
 if(issued>now+30_000||now>=expires||expires-issued>120_000||
    expires<=issued||now-issued>120_000)
   throw Error('expired or future product account proof');
 return claims;
}
export function trustedProductKeyPin(publicKey) {
 const key=publicKey instanceof KeyObject && publicKey.type==='public' ? publicKey : createPublicKey(publicKey);
 if(key.asymmetricKeyType!=='ed25519')throw Error('product proof key type invalid');
 return createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
}
function claimsMatchCommand(claims,command){
 return command?.kind==='link'&&claims.action==='link'&&
 ['applicationId','identityId','organisationId','localUserId','localAccountId']
  .every(k=>claims[k]===command[k]);
}
/** productKeys: immutable operator-controlled mapping app -> {publicKey,pin}.
 * claimNonce(app,nonce,expiresAt): MUST make a durable unique insert/claim,
 * return exactly true only for a first use. The DB enforces uniqueness.
 * This is verification, NOT an endpoint and not operator authorisation.
 */
export function createProductLinkProofVerifier({productKeys,claimNonce,clock=()=>Date.now()}={}){
 if(!productKeys||typeof productKeys!=='object'||Array.isArray(productKeys)||
   typeof claimNonce!=='function'||typeof clock!=='function')
   throw TypeError('trusted product verification dependencies required');
 const keys=new Map();
 for(const [app,config] of Object.entries(productKeys)){
  if(!APPS.has(app)||!config||typeof config.pin!=='string'||!HEX.test(config.pin))
   throw TypeError('invalid pinned product key configuration');
  const key=createPublicKey(config.publicKey);
  if(key.asymmetricKeyType!=='ed25519')throw TypeError('product must use Ed25519');
  const computed=trustedProductKeyPin(key);
  if(!timingSafeEqual(Buffer.from(config.pin,'hex'),Buffer.from(computed,'hex')))
   throw TypeError('product key not independently pinned');
  keys.set(app,key);
 }
 return Object.freeze({
  async verify({proof,command}={}){
   if(!exact(proof,PROOF_FIELDS)||typeof proof.signature!=='string'||
     !BASE64.test(proof.signature))return false;
   let claims;
   try{claims=validateProductLinkClaims(proof.claims,clock());}
   catch{return false;}
   if(!claimsMatchCommand(claims,command))return false;
   const key=keys.get(claims.applicationId);
   if(!key)return false;
   const message=Buffer.from('titan:product-account-control:v1\n'+stableJson(claims));
   const sig=Buffer.from(proof.signature,'base64');
   if(sig.length!==64||!verifySignature(null,message,key,sig))return false;
   try{return await claimNonce(claims.applicationId,claims.nonce,claims.expiresAt)===true;}
   catch{return false;}
  }
 });
}
