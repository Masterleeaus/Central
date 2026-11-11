import {companyId,product,environment,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
export function assertAuthoritativeGrant(grant,requestedProduct,requestedEnvironment){
 product(requestedProduct);environment(requestedEnvironment);
 if(grant?.active!==true||grant.product!==requestedProduct||grant.environment!==requestedEnvironment)fail('unauthorised');
 const id=companyId(grant.companyId);
 if(!Array.isArray(grant.cohorts)||grant.cohorts.length>32)fail('invalid_cohorts');
 for(const cohort of grant.cohorts)identifier(cohort,'cohort');
 return Object.freeze({product:requestedProduct,environment:requestedEnvironment,companyId:id,
   cohorts:Object.freeze([...new Set(grant.cohorts)])});
}
