import {fail} from './errors.mjs';
const safe=/^[A-Za-z0-9_-]{1,256}$/;
/** Construct only from Central's already-verified operator principal and fresh Logto authority. */
export async function verifiedGrantOperator({principal,authoriseOperator}={}){
 if(typeof authoriseOperator!=='function'||!safe.test(principal?.logtoSubject??''))fail('unverified_operator');
 if(principal?.operatorAuthorityVerified!==true)fail('unverified_operator');
 if(await authoriseOperator(principal)!==true)fail('operator_forbidden');
 return Object.freeze({subject:principal.logtoSubject});
}
