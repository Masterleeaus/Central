/** Composition boundary for the Titan Central browser launcher.
 * This is an explicit opt-in handler factory, not an automatically mounted route.
 * The caller supplies a durable session store, trusted company naming source,
 * and validated environment-owned product destinations.
 */
import {createCentralSessionManager} from './central-session.mjs';
import {createPostgresCentralSessionStore} from './central-session-pg.mjs';
import {createCentralProductReader} from './central-product-reader.mjs';
import {createCentralLauncherHandler} from './central-launcher.mjs';
import {createCentralLogoutHandler} from './central-logout.mjs';

export function createCentralLauncherService({pool,sessionStore,getCompanyName,destinations,clock,origin}={}){
  if(!pool?.connect||typeof getCompanyName!=='function')throw new TypeError('trusted Central launcher dependencies required');
  const sessions=createCentralSessionManager({store:sessionStore??createPostgresCentralSessionStore({pool}),...(clock?{clock}:{})});
  const readProducts=createCentralProductReader({pool,getCompanyName});
  const handler=createCentralLauncherHandler({
    resolveSession:req=>sessions.resolve(req),
    readProducts,
    destinations
  });
  const logout=origin?createCentralLogoutHandler({sessions,origin}):null;
  const combined=logout?async(req,res)=> (await logout(req,res)) || handler(req,res):handler;
  return Object.freeze({handler:combined,sessions});
}
