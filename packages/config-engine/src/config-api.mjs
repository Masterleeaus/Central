import {createScopedPgConfigStore} from './scoped-pg-store.mjs';
import {createM2MGateway} from './m2m-gateway.mjs';
import {createConfigHttpReadHandler} from './http-read.mjs';
import {fail} from './errors.mjs';
/** Explicit opt-in API composition. Does not mount routes by itself. */
export function createConfigApi({pool,issuer,audience,jwksUri,lookup,fetcher,clock,salt}={}) {
 if(typeof pool?.connect!=='function'||typeof lookup!=='function'||typeof salt!=='string'||salt.length<16)fail('invalid_config_api');
 const store=createScopedPgConfigStore({pool});
 const auth=createM2MGateway({issuer,audience,jwksUri,lookup,fetcher,clock});
 return createConfigHttpReadHandler({...auth,store,salt,clock});
}
