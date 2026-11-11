import {fail} from './errors.mjs';
/** Bind identity to a dedicated application audience; do not accept browser sessions. */
export function assertServiceRequest(req){
 if(!req||req.method!=='GET'||req.headers?.cookie||req.headers?.['x-forwarded-user']||
    req.headers?.['x-company-id']||typeof req.headers?.authorization!=='string')fail('unauthorised');
 return req.headers.authorization;
}
