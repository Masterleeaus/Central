import {createHash} from 'node:crypto';
import {fail} from './errors.mjs';
export function rolloutPercent(value) {
  if(!Number.isInteger(value)||value<0||value>100)fail('invalid_rollout_percentage');
  return value;
}
export function selectedByRollout({key,companyId,salt,percentage}) {
  rolloutPercent(percentage);
  if(typeof key!=='string'||!key||typeof companyId!=='string'||!companyId||
    typeof salt!=='string'||!salt)fail('invalid_rollout_identity');
  if(percentage===0)return false;
  if(percentage===100)return true;
  const digest=createHash('sha256').update(JSON.stringify([salt,key,companyId])).digest();
  return digest.readUInt32BE(0) / 4294967296 < percentage / 100;
}
