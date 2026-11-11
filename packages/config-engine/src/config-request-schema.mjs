import {identifier,product,environment} from './identifiers.mjs';
import {fail} from './errors.mjs';
export function validateConfigQuery(query){
 if(!query||typeof query!=='object'||Array.isArray(query))fail('invalid_parameters');
 if(Object.keys(query).sort().join(',')!=='application,environment,key')fail('invalid_parameters');
 return Object.freeze({key:identifier(query.key,'key'),application:product(query.application),environment:environment(query.environment)});
}
