import {fail} from './errors.mjs';
const decode=segment=>{
 if(typeof segment!=='string'||segment.length>8192||!/^[A-Za-z0-9_-]+$/.test(segment))fail('unauthorised');
 try {return JSON.parse(Buffer.from(segment,'base64url').toString('utf8'))}catch {fail('unauthorised')}
};
export function jwtParts(token) {
 const parts=token?.split('.');
 if(parts?.length!==3)fail('unauthorised');
 const header=decode(parts[0]),claims=decode(parts[1]);
 if(!header||typeof header!=='object'||Array.isArray(header)||!claims||typeof claims!=='object'||Array.isArray(claims))fail('unauthorised');
 return {header,claims,signingInput:parts.slice(0,2).join('.'),signature:parts[2]};
}
