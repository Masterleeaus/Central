import {createServiceJwtVerifier} from './jwt-verifier.mjs';
import {createServiceRegistry} from './service-registry.mjs';
import {fail} from './errors.mjs';
/** Bridges verified Logto service JWT to centrally-managed company grants. */
export function createM2MGateway({issuer,audience,jwksUri,fetcher,clock,lookup}={}){
 if(typeof lookup!=='function')fail('invalid_service_registry');
 const verify=createServiceJwtVerifier({issuer,audience,jwksUri,fetcher,clock});
 const resolve=createServiceRegistry({lookup});
 return Object.freeze({
  authenticate:async authorization=>{
   const principal=await verify(authorization);
   // Only the registry can assert product grants; do not trust token products.
   return Object.freeze({...principal,products:Object.freeze([])});
  },
  resolveCompany:resolve
 });
}
