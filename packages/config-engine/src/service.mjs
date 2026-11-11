import {validateDefinition} from './definition.mjs';
import {validateOverride} from './override.mjs';
import {evaluateFlag} from './evaluate.mjs';
import {requireConfigAuthority} from './authority.mjs';
import {companyId,environment,product,identifier} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Trusted server-only gateway. Store transactions must atomically persist
 * revision-checked overrides and append audit events; clients cannot supply actor claims.
 * Fails closed if storage or the audit transaction is unavailable. */
export function createConfigService({store,salt,clock=Date.now}) {
  if(typeof store?.getDefinition!=='function'||typeof store?.getOverrides!=='function'||
     typeof store?.commitOverride!=='function'||typeof salt!=='string'||salt.length<16||
     typeof clock!=='function')fail('invalid_service_configuration');
  async function read({actor,key,context}) {
    identifier(key,'key');product(context?.product);environment(context?.environment);companyId(context?.companyId);
    requireConfigAuthority({actor,action:'read',product:context.product,environment:context.environment});
    const raw=await store.getDefinition(key,context.product);
    if(!raw)fail('unknown_flag');
    const definition=validateDefinition(raw);
    const overrides=(await store.getOverrides(key,context.product,context.environment)).map(row=>validateOverride(definition,row));
    return evaluateFlag({definition,overrides,context,now:clock(),salt});
  }
  async function write({actor,key,override,expectedRevision,reason}) {
    identifier(key,'key');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid_expected_revision');
    if(typeof reason!=='string'||reason.trim().length<8||reason.length>512)fail('invalid_change_reason');
    const app=product(override?.product),env=environment(override?.environment);
    const auth=requireConfigAuthority({actor,action:'write',product:app,environment:env});
    const raw=await store.getDefinition(key,app);
    if(!raw)fail('unknown_flag');
    const validated=validateOverride(validateDefinition(raw),override);
    if(validated.revision!==expectedRevision+1)fail('revision_mismatch');
    return store.commitOverride({key,override:validated,expectedRevision,
      audit:{actorId:auth.actorId,action:'config_override_changed',key,product:app,environment:env,
        revision:validated.revision,reason:reason.trim(),recordedAt:new Date(clock()).toISOString()}});
  }
  return Object.freeze({read,write});
}
