import {validateTarget} from './targets.mjs';
export function scopeOf(input={}) {
 const target=validateTarget(input);
 return target.companyId?{kind:'company',scope:target.companyId}:
   target.cohort?{kind:'cohort',scope:target.cohort}:{kind:'environment',scope:'*'};
}
