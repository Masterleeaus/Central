import {fail} from './errors.mjs';
/** Only allow exact grant attributes, never arbitrary SQL keys or principal claims. */
const ALLOWED=new Set(['clientId','product','environment','companyId','state','cohorts','expiresAt','expectedRevision']);
export function validateGrantChangeBody(body,operation){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_grant_body');
 for(const k of Object.keys(body))if(!ALLOWED.has(k))fail('invalid_grant_body');
 if(operation==='create'&&Object.hasOwn(body,'expectedRevision'))fail('invalid_grant_body');
 if(operation==='transition'&&!Object.hasOwn(body,'expectedRevision'))fail('invalid_grant_body');
 return Object.freeze({...body});
}
