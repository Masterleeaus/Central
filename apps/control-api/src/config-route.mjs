import {createConfigApi} from '../../../packages/config-engine/src/config-api.mjs';
import {createRateLimiter} from './rate-limit.mjs';
/** Disabled unless deployment explicitly opts in and injects canonical grants. */
export function createConfigRoute({env={},pool,lookup,fetcher,logger=()=>{},clock=Date.now,
 clientIp=req=>req.socket?.remoteAddress??'unknown',limits={limit:60,windowMs:60000}}={}){
 if(env.TITAN_CONFIG_ENABLED!=='true')return undefined;
 const {TITAN_CONFIG_AUDIENCE,TITAN_CONFIG_SALT,TITAN_OIDC_ISSUER,TITAN_OIDC_JWKS_URI}=env;
 if(!pool||typeof lookup!=='function'||!TITAN_CONFIG_AUDIENCE||!TITAN_CONFIG_SALT||
  !TITAN_OIDC_ISSUER||!TITAN_OIDC_JWKS_URI)throw Error('config route requires trusted grant lookup and secrets');
 const limiter=createRateLimiter(limits);
 const handle=createConfigApi({pool,lookup,issuer:TITAN_OIDC_ISSUER,audience:TITAN_CONFIG_AUDIENCE,
  jwksUri:TITAN_OIDC_JWKS_URI,salt:TITAN_CONFIG_SALT,fetcher,clock});
 return async(req,res)=>{
  const url=new URL(req.url??'/', 'http://localhost');
  if(url.pathname!=='/v1/config/evaluate')return false;
  const decision=limiter.take(clientIp(req));
  if(!decision.allowed){
   logger('config_rate_limited',{scope:'ip'});
   res.writeHead(429,{'cache-control':'no-store','retry-after':String(decision.retryAfterSeconds),
    'content-type':'application/json; charset=utf-8'});
   res.end(JSON.stringify({error:'rate_limited'}));return true;
  }
  return handle(req,res);
 };
}
