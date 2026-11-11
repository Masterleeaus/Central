import {fail} from './errors.mjs';
const TOKEN=/^[a-z][a-z0-9_-]{0,63}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function identifier(value, kind='identifier') {
  if(typeof value!=='string'||!TOKEN.test(value))fail('invalid_'+kind);
  return value;
}
export function companyId(value) {
  if(typeof value!=='string'||!UUID.test(value))fail('invalid_company_id');
  return value.toLowerCase();
}
export function environment(value) {
  return identifier(value,'environment');
}
export function product(value) {
  if(!['sorted','supercharged','lms','central'].includes(value))fail('invalid_product');
  return value;
}
