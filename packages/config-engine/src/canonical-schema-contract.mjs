import {fail} from './errors.mjs';
/** Shared company contract originates in open PR #46, not this repository branch. */
export const CANONICAL_RELATIONS=Object.freeze(["titan.companies","titan.identities","titan.company_memberships","titan.application_entitlements","titan.application_company_links","titan.application_user_links","titan.schema_migrations"]);
export const CANONICAL_FOREIGN_KEYS=Object.freeze([["titan.company_memberships","company_id","titan.companies"],["titan.company_memberships","identity_id","titan.identities"],["titan.application_entitlements","company_id","titan.companies"],["titan.application_company_links","company_id","titan.companies"],["titan.application_user_links","company_id","titan.companies"],["titan.application_user_links","identity_id","titan.identities"],["titan_config.service_company_grants","company_id","titan.companies"]]);
export function assertCanonicalSchema({relations,foreignKeys}={}){
 if(!Array.isArray(relations)||!Array.isArray(foreignKeys))fail('invalid_schema_catalog');
 const present=new Set(relations);
 if(CANONICAL_RELATIONS.some(name=>!present.has(name)))fail('canonical_schema_missing');
 const edges=new Set(foreignKeys.map(x=>[x.table,x.column,x.target].join('|')));
 if(CANONICAL_FOREIGN_KEYS.some(x=>!edges.has(x.join('|'))))fail('canonical_foreign_key_missing');
 return true;
}
