import {validateValue} from './types.mjs';
import {validateTarget} from './targets.mjs';
import {rolloutPercent} from './rollout.mjs';
import {environment,product} from './identifiers.mjs';
import {fail} from './errors.mjs';
export function validateOverride(definition,input) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_override');
  if(Object.keys(input).some(k=>!['product','environment','target','value','percentage','expiresAt','revision'].includes(k)))fail('unexpected_override_field');
  if(product(input.product)!==definition.product)fail('product_mismatch');
  const env=environment(input.environment);
  const target=validateTarget(input.target??{});
  const value=validateValue(definition.type,input.value,definition.allowedValues);
  const percentage=rolloutPercent(input.percentage??100);
  if(!Number.isSafeInteger(input.revision)||input.revision<1)fail('invalid_revision');
  let expiresAt=null;
  if(input.expiresAt!==undefined&&input.expiresAt!==null) {
    const time=Date.parse(input.expiresAt);
    if(typeof input.expiresAt!=='string'||!Number.isFinite(time)||new Date(time).toISOString()!==input.expiresAt)fail('invalid_expiry');
    expiresAt=input.expiresAt;
  }
  return Object.freeze({product:definition.product,environment:env,target,value,percentage,expiresAt,revision:input.revision});
}
