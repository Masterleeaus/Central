import {companyId,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
export function validateTarget(target) {
  if(!target||typeof target!=='object'||Array.isArray(target))fail('invalid_target');
  if(Object.keys(target).some(k=>!['companyId','cohort'].includes(k)))fail('invalid_target');
  if(target.companyId!==undefined&&target.cohort!==undefined)fail('ambiguous_target');
  if(target.companyId!==undefined)return Object.freeze({companyId:companyId(target.companyId)});
  if(target.cohort!==undefined)return Object.freeze({cohort:identifier(target.cohort,'cohort')});
  return Object.freeze({});
}
export function matchesTarget(target,context) {
  if(target.companyId!==undefined)return context.companyId===target.companyId;
  if(target.cohort!==undefined)return Array.isArray(context.cohorts)&&context.cohorts.includes(target.cohort);
  return true;
}
