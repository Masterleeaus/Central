import {environment,product,companyId} from './identifiers.mjs';
import {matchesTarget} from './targets.mjs';
import {selectedByRollout} from './rollout.mjs';
import {fail} from './errors.mjs';
export function evaluateFlag({definition,overrides=[],context,now=Date.now(),salt}) {
  if(!definition||!Array.isArray(overrides)||!context||!Number.isFinite(now))fail('invalid_evaluation');
  if(product(context.product)!==definition.product)fail('product_mismatch');
  environment(context.environment);
  companyId(context.companyId);
  if(typeof salt!=='string'||!salt)fail('missing_rollout_salt');
  const eligible=overrides.filter(item=>item.product===definition.product &&
    item.environment===context.environment && matchesTarget(item.target,context) &&
    (item.expiresAt===null||Date.parse(item.expiresAt)>now) &&
    selectedByRollout({key:definition.key,companyId:context.companyId,salt,percentage:item.percentage}));
  // Specific company always beats cohort, which always beats environment default.
  const priority=item=>item.target.companyId?3:item.target.cohort?2:1;
  eligible.sort((a,b)=>priority(b)-priority(a)||b.revision-a.revision);
  const winner=eligible[0];
  return Object.freeze({key:definition.key,value:winner?winner.value:definition.defaultValue,
    revision:winner?.revision??0,source:winner?'override':'default'});
}
