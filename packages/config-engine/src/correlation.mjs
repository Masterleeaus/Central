import {randomUUID} from 'node:crypto';
import {fail} from './errors.mjs';
export function correlationId(generator=randomUUID){
 if(typeof generator!=='function')fail('invalid_generator');
 const id=generator();
 if(typeof id!=='string'||id.length<1||id.length>128||
    /[^a-zA-Z0-9_-]/.test(id))fail('invalid_correlation_id');
 return id;
}
