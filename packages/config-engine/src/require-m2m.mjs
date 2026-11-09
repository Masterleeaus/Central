import {fail} from './errors.mjs';
export function requireM2M(principal,application){
 if(!principal||principal.authenticated!==true||principal.kind!=='service'||
   !Array.isArray(principal.products)||!principal.products.includes(application))fail('unauthorised');
 return principal;
}
