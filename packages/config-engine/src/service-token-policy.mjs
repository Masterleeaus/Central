import {fail} from './errors.mjs';
export function assertServiceClientClaims(claims){
 if(!claims||typeof claims!=='object'||Array.isArray(claims))fail('unauthorised');
 const id=claims.client_id??claims.azp;
 if(typeof id!=='string'||!/^[a-zA-Z0-9:_-]{1,256}$/.test(id))fail('unauthorised');
 if(claims.client_id!==undefined&&claims.azp!==undefined&&claims.client_id!==claims.azp)fail('unauthorised');
 return id;
}
