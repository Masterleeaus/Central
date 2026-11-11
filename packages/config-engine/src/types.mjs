import {fail} from './errors.mjs';
export function validateValue(type,value,allowed) {
  if(type==='boolean') {
    if(typeof value!=='boolean')fail('invalid_boolean_value');
  } else if(type==='integer') {
    if(!Number.isSafeInteger(value))fail('invalid_integer_value');
  } else if(type==='string') {
    if(typeof value!=='string'||value.length>1024)fail('invalid_string_value');
  } else fail('invalid_flag_type');
  if(allowed!==undefined) {
    if(!Array.isArray(allowed)||allowed.length===0||allowed.length>64)fail('invalid_allowed_values');
    if(allowed.some(item=>typeof item!==typeof value||!['string','number','boolean'].includes(typeof item)))fail('invalid_allowed_values');
    if(new Set(allowed).size!==allowed.length)fail('duplicate_allowed_values');
    if(!allowed.includes(value))fail('value_not_allowed');
  }
  return value;
}
