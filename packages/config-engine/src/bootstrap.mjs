import {createPgConfigStore} from './pg-store.mjs';
import {createConfigService} from './service.mjs';
import {createRollback} from './rollback.mjs';
export function createConfigEngine({pool,salt,correlationId,clock}={}) {
 const store=createPgConfigStore({pool,...(correlationId?{correlationId}:{})});
 const service=createConfigService({store,salt,...(clock?{clock}:{})});
 return Object.freeze({store,read:service.read,write:service.write,
  rollback:createRollback({store})});
}
