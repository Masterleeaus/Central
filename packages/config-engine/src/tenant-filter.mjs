import {companyId} from './identifiers.mjs';
import {fail} from './errors.mjs';
export function restrictTenantOverrides(items,context) {
 const id=companyId(context?.companyId);
 if(!Array.isArray(items))fail('invalid_overrides');
 return items.filter(x=>x?.target?.companyId===undefined||
  (typeof x.target.companyId==='string'&&x.target.companyId.toLowerCase()===id));
}
