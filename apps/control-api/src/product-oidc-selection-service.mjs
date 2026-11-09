/** App-owned composition for multi-company OIDC authentication.
 * The product independently supplies trusted membership discovery, current
 * entitlement and local account verification, and atomic app session
 * rotation. Nothing here uses a browser-provided tenant as authority.
 *
 * This service deliberately does not automatically mount a route: the
 * application's own server must wire the exact endpoint and proxy quotas.
 */
import {createVerifiedIdentityResolver} from './oidc-app-session.mjs';
import {createPostgresProductSelectionStore} from './product-selection-pg.mjs';
import {createProductSelectionHttp} from './product-selection-http.mjs';
import {createOidcHttpAdapter} from './oidc-http-adapter.mjs';

export function createProductMultiCompanyOidcService({
 applicationId,issuer,audience,origin,oidcLogin,pool,sealer,
 findOrganisationIds,authorise,localAccountActive,listOrganisations,
 rotateAppSession,afterLogin='/',sessionCookieName,
 selectionStore,establishSession,logger,
 rateLimits,concurrencyLimits,clock
}={}){
 if(typeof listOrganisations!=='function'||
   typeof findOrganisationIds!=='function'||
   typeof authorise!=='function'||
   typeof localAccountActive!=='function'||
   typeof establishSession!=='function'||
   !(selectionStore||pool?.connect))
  throw TypeError('trusted product multi-company authentication dependencies required');
 // Resolver rechecks membership, product entitlement AND local account
 // directly before session issue. Selected company is revalidated against
 // fresh discovery and cannot widen its original browser-bound choice.
 const resolveLocalIdentity=createVerifiedIdentityResolver({
  applicationId,issuer,audience,findOrganisationIds,authorise,
  localAccountActive,...(clock?{clock:()=>new Date(clock()).toISOString()}:{})
 });
 const store=selectionStore??createPostgresProductSelectionStore({
  pool,applicationId,...(sealer?{sealer}:{}),...(clock?{clock}:{})
 });
 const selectionFlow=createProductSelectionHttp({
  applicationId,origin,selectionStore:store,listOrganisations,
  resolveLocalIdentity,establishSession,afterLogin
 });
 const verifiedSelectionFlow=Object.freeze({
  handle:(req,res)=>selectionFlow.handle(req,res),
  async begin({issuer:verifiedIssuer,subject,browserBinding},res){
   // Bind choice to the initial trusted Central membership snapshot. The
   // resolver independently refreshes eligibility again at selection time.
   let allowedCompanyIds;
   try{allowedCompanyIds=await findOrganisationIds({issuer:verifiedIssuer,subject});}
   catch{allowedCompanyIds=[];}
   return selectionFlow.begin({issuer:verifiedIssuer,subject,browserBinding,allowedCompanyIds},res);
  }
 });
 const handler=createOidcHttpAdapter({
  applicationId,oidcLogin,resolveLocalIdentity,establishSession,
  afterLogin,selectionFlow:verifiedSelectionFlow,...(logger?{logger}:{}),
  ...(rateLimits?{rateLimits}:{}),
  ...(concurrencyLimits?{concurrencyLimits}:{})
 });
 return Object.freeze({handler,selectionFlow,resolveLocalIdentity});
}
