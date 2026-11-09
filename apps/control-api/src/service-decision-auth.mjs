/** Fixed-length constant-time comparison; invalid service credentials never touch DB. */
import {createHash,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value,'utf8').digest();
export function authenticateSkilledService(header,configured){
 if(typeof configured!=='string'||configured.length<32||typeof header!=='string'||
   !/^Bearer [A-Za-z0-9_.-]{32,1024}$/.test(header))return false;
 const token=header.slice(7);
 return timingSafeEqual(digest(token),digest(configured));
}
