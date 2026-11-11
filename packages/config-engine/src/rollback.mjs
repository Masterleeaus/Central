import {validateDefinition} from './definition.mjs';
import {validateOverride} from './override.mjs';
import {requireConfigAuthority} from './authority.mjs';
import {identifier,product,environment} from './identifiers.mjs';
import {fail} from './errors.mjs';
export function createRollback({store}) {
 if(!store?.getHistoricalOverride||!store?.getDefinition||!store?.commitOverride)fail('invalid_rollback_store');
 return async ({actor,key,product:app,environment:env,target={},toRevision,expectedRevision,reason})=>{
  identifier(key,'key');product(app);environment(env);
  const grant=requireConfigAuthority({actor,action:'rollback',product:app,environment:env});
  if(!Number.isSafeInteger(toRevision)||toRevision<1||
     !Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('invalid_revision');
  if(typeof reason!=='string'||reason.trim().length<8||reason.length>512)fail('invalid_reason');
  const old=await store.getHistoricalOverride({key,product:app,environment:env,target,revision:toRevision});
  if(!old)fail('unknown_revision');
  const def=validateDefinition(await store.getDefinition(key,app));
  const override=validateOverride(def,{...old,revision:expectedRevision+1});
  return store.commitOverride({key,override,expectedRevision,
   audit:{actorId:grant.actorId,action:'config_override_rolled_back',reason:reason.trim()}});
 };
}
