import {identifier,product} from './identifiers.mjs';
import {validateValue} from './types.mjs';
import {fail} from './errors.mjs';
export function validateDefinition(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_definition');
  const {key,owner,product:app,type,defaultValue,allowedValues}=input;
  identifier(key,'key');identifier(owner,'owner');product(app);
  validateValue(type,defaultValue,allowedValues);
  if(Object.keys(input).some(k=>!['key','owner','product','type','defaultValue','allowedValues','description'].includes(k)))fail('unexpected_definition_field');
  if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>512))fail('invalid_description');
  return Object.freeze({key,owner,product:app,type,defaultValue, ...(allowedValues?{allowedValues:Object.freeze([...allowedValues])}:{}),description:input.description??''});
}
