/** Composition boundary for the Titan Central browser launcher.
 * This is an explicit opt-in handler factory, not an automatically mounted route.
 * The caller supplies a durable session store, trusted company naming source,
 * and validated environment-owned product destinations.
 */
import {createCentralSessionManager} from './central-session.mjs';
import {createCentralProductReader} from './central-product-reader.mjs';
import {createCentralLauncherHandler} from './central-launcher.mjs';

export function createCentralLauncherService({pool,sessionStore,getCompanyName,destinations,clock}={}){
  if(!pool?.connect||!sessionStore||typeof getCompanyName!=='function')throw new TypeError('trusted Central launcher dependencies required');
  const sessions=createCentralSessionManager({store:sessionStore,...(clock?{clock}:{})});
  const readProducts=createCentralProductReader({pool,getCompanyName});
  const handler=createCentralLauncherHandler({
    resolveSession:req=>sessions.resolve(req),
    readProducts,
    destinations
  });
  return Object.freeze({handler,sessions});
}
