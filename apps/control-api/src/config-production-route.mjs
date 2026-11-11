import {createPgAuthenticatedConfigHandler} from '../../../packages/config-engine/src/pg-config-composition.mjs';
import {createRateLimiter} from './rate-limit.mjs';
/** Server-only config endpoint. Never reuse the Central operational pool. */
export function createProductionConfigRoute({env={},runtime,fetcher,clock=Date.now,logger=()=>{},
 limits={limit:60,windowMs:60000},clientIp=req=>req.socket?.remoteAddress??'unknown'}={}){
 if(env.TITAN_CONFIG_ENABLED!=='true')return undefined;
 if(!runtime?.configPool||!runtime?.grantPool)throw Error('missing dedicated configuration pools');
 const handler=createPgAuthenticatedConfigHandler({configPool:runtime.configPool,grantPool:runtime.grantPool,
  issuer:env.TITAN_OIDC_ISSUER,jwksUri:env.TITAN_OIDC_JWKS_URI,
  audience:env.TITAN_CONFIG_AUDIENCE,salt:env.TITAN_CONFIG_SALT,fetcher,clock});
 const limiter=createRateLimiter(limits);
 return async(req,res)=>{
  const pathname=new URL(req.url??'/','http://localhost').pathname;
  if(pathname!=='/v1/config/evaluate')return false;
  const result=limiter.take(clientIp(req));
  if(!result.allowed){
   logger('config_rate_limited',{scope:'ip'});
   res.writeHead(429,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','retry-after':String(result.retryAfterSeconds)});
   res.end(JSON.stringify({error:'rate_limited'}));return true;
  }
  return handler(req,res);
 };
}
