import {grantOperationScope} from './grant-operation-scope.mjs';
import {fail} from './errors.mjs';
export function createGrantPolicyGuard({isCompanyActive,isOperatorEntitled}={}){
 if(typeof isCompanyActive!=='function'||typeof isOperatorEntitled!=='function')fail('invalid_grant_policy');
 return async input=>{
  const scope=grantOperationScope(input);
  if(await isCompanyActive(scope.companyId)!==true)return false;
  return await isOperatorEntitled({operatorSubject:input.operatorSubject,...scope})===true;
 };
}
