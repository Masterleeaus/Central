/** Central login state uses the same one-use encrypted adapter, with a distinct
 * transaction-local PostgreSQL role and application namespace. */
import {createPostgresOidcStateStore} from './oidc-state-pg.mjs';
export function createCentralOidcStateStore({pool,sealer,clock}={}){
  return createPostgresOidcStateStore({pool,applicationId:'central',role:'titan_central_oidc',
    ...(sealer?{sealer}:{}),...(clock?{clock}:{})});
}
