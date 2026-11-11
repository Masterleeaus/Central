import {fail} from './errors.mjs';
export function requireConfigAuthority({actor,action,product,environment}) {
  if(!actor||typeof actor.id!=='string'||!actor.id||!Array.isArray(actor.permissions))fail('unauthorised');
  if(!['read','write','rollback'].includes(action))fail('invalid_action');
  const exact='config:'+action+':'+product+':'+environment;
  if(!actor.permissions.includes(exact))fail('unauthorised');
  return Object.freeze({actorId:actor.id,action,product,environment});
}
