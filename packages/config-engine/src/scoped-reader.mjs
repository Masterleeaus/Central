import {companyId,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Creates an immutable, server-owned tenant context for a scoped DB read.
 * The pool must enforce restricted SQL role and not expose arbitrary queries. */
export function createScopedSnapshotReader({store}={}){
 if(typeof store?.readSnapshot!=='function')fail('invalid_snapshot_store');
 return Object.freeze({readSnapshot:async({key,product,environment,companyId:id,cohorts=[]})=>{
  const tenant=companyId(id);
  if(!Array.isArray(cohorts)||cohorts.length>32)fail('invalid_cohorts');
  cohorts.forEach(c=>identifier(c,'cohort'));
  return store.readSnapshot({key,product,environment,companyId:tenant,cohorts:[...new Set(cohorts)]});
 }});
}
