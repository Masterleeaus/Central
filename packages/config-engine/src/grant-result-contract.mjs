import {fail} from './errors.mjs';
export function verifiedGrantMutationResult(result){
 if(!result||typeof result.id!=='string'||!/^[1-9][0-9]*$/.test(result.id)||
 !Number.isSafeInteger(result.revision)||result.revision<1)fail('invalid_grant_result');
 return Object.freeze({id:result.id,revision:result.revision});
}
