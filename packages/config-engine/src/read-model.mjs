import {validateDefinition} from './definition.mjs';
import {validateOverride} from './override.mjs';
import {evaluateFlag} from './evaluate.mjs';
import {restrictTenantOverrides} from './tenant-filter.mjs';
import {identifier,product,environment,companyId} from './identifiers.mjs';
import {fail} from './errors.mjs';
import {assertSnapshot} from './snapshot-policy.mjs';
import {publicDecision} from './public-decision.mjs';
/** One repeatable-read database snapshot, with tenant-specific overrides
 * filtered before evaluation. No client-provided company context permitted. */
export async function readTenantFlag({store,key,context,salt,now=Date.now()}){
 identifier(key,'key');product(context?.product);environment(context?.environment);companyId(context?.companyId);
 if(typeof store?.readSnapshot!=='function')fail('snapshot_required');
 const snapshot=assertSnapshot(await store.readSnapshot({key,product:context.product,environment:context.environment,companyId:context.companyId,cohorts:context.cohorts??[]}));
 if(!snapshot?.definition)fail('unknown_flag');
 const def=validateDefinition(snapshot.definition);
 const overrides=restrictTenantOverrides(snapshot.overrides??[],context).map(o=>validateOverride(def,o));
 return publicDecision(evaluateFlag({definition:def,overrides,context,salt,now}));
}
