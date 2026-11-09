import {createM2MGateway} from './m2m-gateway.mjs';
import {createConfigReadTransport} from './transport.mjs';
export function createAuthenticatedConfigReader({issuer,audience,fetcher,clock,lookup,store,salt}={}){
 const auth=createM2MGateway({issuer,audience,fetcher,clock,lookup});
 return createConfigReadTransport({...auth,store,salt,clock});
}
