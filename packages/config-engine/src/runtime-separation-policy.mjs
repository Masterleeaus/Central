import {fail} from './errors.mjs';
export function assertRuntimePoolIsolation({controlPool,configPool,grantPool}){
 if(!controlPool||!configPool||!grantPool||
 new Set([controlPool,configPool,grantPool]).size!==3)fail('shared_privileged_pool');
 return true;
}
