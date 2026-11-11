import {fail} from './errors.mjs';
const subject=/^[A-Za-z0-9_-]{1,256}$/;
export function auditActorFromPrincipal(principal){
 if(principal?.operatorAuthorityVerified!==true||typeof principal.logtoSubject!=='string'||
 !subject.test(principal.logtoSubject))fail('unverified_operator');
 return principal.logtoSubject;
}
