import {product,environment,companyId,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Trusted server integration only; never feed unverified HTTP claim values. */
export function verifiedContext({principal,product:app,environment:env,companyId:id,cohorts=[]}) {
 product(app);environment(env);const canonical=companyId(id);
 if(principal?.authenticated!==true||principal.kind!=='service'||!principal.products?.includes(app))fail('unauthorised');
 if(!Array.isArray(cohorts)||cohorts.length>32)fail('invalid_cohorts');
 cohorts.forEach(c=>identifier(c,'cohort'));
 return Object.freeze({product:app,environment:env,companyId:canonical,cohorts:Object.freeze([...new Set(cohorts)])});
}
