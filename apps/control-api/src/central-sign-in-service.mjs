/** Explicit Central login composition. Not mounted by the API server.
 * Uses existing tested PKCE/OIDC code and Central's isolated encrypted state.
 * Operator must supply verified issuer, client registration, and live membership
 * resolvers. Application-specific product sessions are never reused.
 */
import {createOidcLogin} from './oidc-login.mjs';
import {createCentralOidcStateStore} from './central-oidc-state-pg.mjs';
import {createCentralOidcBrowserHandler} from './central-oidc-browser.mjs';
import {createCentralCompanyAuthority} from './central-company-authority.mjs';

export function createCentralSignInService({pool,sessions,issuer,clientId,clientSecret,redirectUri,
  verifyIdToken,listEligibleCompanies,recheckCompany,getCompanyName,fetcher,stateStore,sealer,clock,
  allowInsecureLocalhost=false,logger}={}){
  const customAuthority=typeof listEligibleCompanies==='function'&&typeof recheckCompany==='function';
  const builtinAuthority=listEligibleCompanies==null&&recheckCompany==null&&typeof getCompanyName==='function';
  if(!pool?.connect||typeof sessions?.issue!=='function'||typeof verifyIdToken!=='function'||(!customAuthority&&!builtinAuthority))
    throw new TypeError('trusted Central sign-in dependencies required');
  let redirect;
  try{redirect=new URL(redirectUri);}catch{throw new TypeError('invalid Central callback URL');}
  if(redirect.pathname!=='/auth/central/callback'||redirect.search||redirect.hash||
    redirect.username||redirect.password||
    !(redirect.protocol==='https:'||(allowInsecureLocalhost&&redirect.protocol==='http:'&&redirect.hostname==='localhost')))
    throw new TypeError('Central redirect URI must match exact callback path');
  const store=stateStore??createCentralOidcStateStore({pool,...(sealer?{sealer}:{}),...(clock?{clock}:{})});
  const oidcLogin=createOidcLogin({issuer,clientId,clientSecret,redirectUri,
    loginStore:store,verifyIdToken,allowInsecureLocalhost,
    ...(fetcher?{fetcher}:{}),...(clock?{clock}:{})});
  const authority=builtinAuthority?createCentralCompanyAuthority({pool,issuer,getCompanyName}):null;
  const handler=createCentralOidcBrowserHandler({oidcLogin,sessions,
    listEligibleCompanies:listEligibleCompanies??authority.listEligibleCompanies,
    recheckCompany:recheckCompany??authority.recheckCompany,allowInsecureLocalhost,
    ...(logger?{logger}:{})});
  return Object.freeze({handler});
}
