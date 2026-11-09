import {fail} from './errors.mjs';
export function denyOnFailure(def) {
 if(def?.type!=='boolean'||def.defaultValue!==false||typeof def.key!=='string')fail('unsafe_default');
 return Object.freeze({key:def.key,value:false,revision:0,source:'safe_default'});
}
