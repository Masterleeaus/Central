import {fail} from './errors.mjs';
export function readBearer(input) {
 if(typeof input!=='string'||input.length>16392||!/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(input))fail('unauthorised');
 const token=input.slice(7);
 if(token.split('.').length!==3||token.length<24)fail('unauthorised');
 return token;
}
