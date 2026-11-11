import {companyId,product,environment} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Explicit scope binding; operator auth does not automatically grant every company. */
export function grantOperationScope(input){
 if(!input||!['create','transition'].includes(input.operation))fail('invalid_grant_operation');
 return Object.freeze({companyId:companyId(input.companyId),product:product(input.product),
  environment:environment(input.environment),operation:input.operation});
}
