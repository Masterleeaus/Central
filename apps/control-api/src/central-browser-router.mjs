/** Explicitly gated first-party Central browser router.
 * Disabled by default. No user-request data configures product destinations,
 * OIDC issuer/JWKS, company names or the callback. A trusted company-name
 * resolver is required at startup rather than falling back to browser claims.
 */
import {createCentralLauncherService} from './central-launcher-service.mjs';
import {createCentralSignInService} from './central-sign-in-service.mjs';
import {createIdTokenVerifier} from './oidc-id-token.mjs';
import {createStateSealer,parseStateKey} from './oidc-state-crypto.mjs';
import {createConcurrencyLimiter} from './concurrency-limit.mjs';

function secureOrigin(value){
  if(typeof value!=='string')throw new TypeError('secure Central origin required');
  let parsed;
  try{parsed=new URL(value);}catch{throw new TypeError('invalid Central origin');}
  if(parsed.protocol!=='https:'||parsed.href!==parsed.origin+'/'||parsed.username||parsed.password)
    throw new TypeError('Central browser origin must be an HTTPS origin');
  return parsed.origin;
}
function config(env){
  const enabled=env.TITAN_CENTRAL_BROWSER_ENABLED;
  if(enabled!==undefined&&enabled!=='0'&&enabled!=='1')throw new TypeError('invalid Central browser feature flag');
  if(enabled!=='1')return null;
  const origin=secureOrigin(env.TITAN_CENTRAL_BROWSER_ORIGIN);
  const redirectUri=env.TITAN_CENTRAL_BROWSER_REDIRECT_URI;
  if(redirectUri!==origin+'/auth/central/callback')throw new TypeError('registered Central callback mismatch');
  for(const key of ['TITAN_OIDC_ISSUER','TITAN_OIDC_JWKS_URI','TITAN_CENTRAL_BROWSER_CLIENT_ID',
    'TITAN_CENTRAL_BROWSER_CLIENT_SECRET','TITAN_OIDC_STATE_KEY']){
    if(typeof env[key]!=='string'||!env[key])throw new TypeError('missing Central browser credential or signing state key: '+key);
  }
  const destinations={
    sorted:env.TITAN_CENTRAL_SORTED_ORIGIN,
    supercharged:env.TITAN_CENTRAL_SUPERCHARGED_ORIGIN,
    lms:env.TITAN_CENTRAL_LMS_ORIGIN
  };
  return {origin,redirectUri,destinations};
}
export function createCentralBrowserRouter({env=process.env,pool,getCompanyName,fetcher,
  verifyIdToken,launcherStore,stateStore,selectionStore,logger,concurrencyLimits={perKey:5,globalLimit:72},clientIp=req=>req.socket?.remoteAddress??'unknown'}={}){
  const settings=config(env);
  if(!settings)return null;
  if(!pool?.connect||typeof getCompanyName!=='function')
    throw new TypeError('trusted Central browser database and company name authority required');
  const sealer=createStateSealer({key:parseStateKey(env.TITAN_OIDC_STATE_KEY)});
  const verifier=verifyIdToken??createIdTokenVerifier({
    issuer:env.TITAN_OIDC_ISSUER,clientId:env.TITAN_CENTRAL_BROWSER_CLIENT_ID,
    jwksUri:env.TITAN_OIDC_JWKS_URI,...(fetcher?{fetcher}:{})
  });
  const launcher=createCentralLauncherService({
    pool,getCompanyName,destinations:settings.destinations,origin:settings.origin,
    ...(launcherStore?{sessionStore:launcherStore}:{})
  });
  const signIn=createCentralSignInService({
    pool,sessions:launcher.sessions,issuer:env.TITAN_OIDC_ISSUER,
    clientId:env.TITAN_CENTRAL_BROWSER_CLIENT_ID,
    clientSecret:env.TITAN_CENTRAL_BROWSER_CLIENT_SECRET,
    redirectUri:settings.redirectUri,
    verifyIdToken:verifier,getCompanyName,enableCompanySelection:true,sealer,
    ...(fetcher?{fetcher}:{}),...(stateStore?{stateStore}:{}),
    ...(selectionStore?{selectionStore}:{}),...(logger?{logger}:{})
  });
  const concurrent=createConcurrencyLimiter(concurrencyLimits);
  return Object.freeze({
    async handler(req,res){
      const guarded=req.url?.startsWith('/auth/central/')||req.url?.startsWith('/central');
      const release=guarded?concurrent.acquire(clientIp(req)):()=>{};
      if(!release){res.writeHead(429,{'cache-control':'no-store','retry-after':'1'});res.end();return true;}
      try{
        if(await signIn.handler(req,res))return true;
        return launcher.handler(req,res);
      }finally{release();}
    },
    sessions:launcher.sessions
  });
}
