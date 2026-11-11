import {fail} from './errors.mjs';
export function requireSeparateReadPools(configPool,grantPool){
 if(typeof configPool?.connect!=='function'||typeof grantPool?.connect!=='function'||configPool===grantPool)fail('shared_privileged_pool');
 return true;
}
