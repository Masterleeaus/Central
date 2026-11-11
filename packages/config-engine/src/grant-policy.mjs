import {fail} from './errors.mjs';
export function grantRevision({expected,next}){
 if(!Number.isSafeInteger(expected)||expected<0||!Number.isSafeInteger(next)||next!==expected+1)
  fail('grant_revision_conflict');
 return next;
}
export function grantStateAllowed(state,expiresAt,now=Date.now()){
 if(state!=='active')return false;
 if(expiresAt==null)return true;
 const expiry=Date.parse(expiresAt);
 return Number.isFinite(expiry)&&expiry>now;
}
