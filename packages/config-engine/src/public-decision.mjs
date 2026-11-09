import {fail} from './errors.mjs';
export function publicDecision(d){
 if(!d||typeof d.key!=='string'||!['override','default'].includes(d.source)||
  !Number.isSafeInteger(d.revision)||d.revision<0||
  !['string','number','boolean'].includes(typeof d.value)||d.value===null)fail('invalid_decision');
 return Object.freeze({key:d.key,value:d.value,revision:d.revision,source:d.source});
}
