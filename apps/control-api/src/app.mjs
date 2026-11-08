import { CentralAccessService, withCentralReadSnapshot } from '../../../packages/control-plane/dist/index.js';

const apps=new Set(['sorted','supercharged','lms']);
const noStore={ 'cache-control':'no-store', 'content-type':'application/json; charset=utf-8', 'x-content-type-options':'nosniff' };
function respond(res, status, body) {res.writeHead(status,noStore);res.end(JSON.stringify(body));}
function bearer(req) {const h=req.headers.authorization;if(typeof h!=='string'||!/^Bearer [A-Za-z0-9_\-.]+$/.test(h)) return;return h.slice(7);}
/** No administrative mutations or user-controlled SQL. Organisation/app/action are the only request inputs. */
export function createCentralHandler({ pool, verifyToken, issuer, audience, adminHandler, logger=()=>{} }) {
  if (!pool || !verifyToken || !issuer || !audience) throw new Error('missing Central API dependencies');
  const trust={expectedIssuer:issuer,audienceByApplication:{sorted:audience,supercharged:audience,lms:audience}};
  return async (req,res)=>{
    const pathname=new URL(req.url??'/', 'http://localhost').pathname;
    if (req.method==='GET' && pathname==='/healthz') return respond(res,200,{status:'ok'});
    if (pathname.startsWith('/v1/admin/')) {
      if(!adminHandler) return respond(res,404,{error:'not_found'});
      if(await adminHandler(req,res)) return;
      return respond(res,404,{error:'not_found'});
    }
    if (pathname!=='/v1/access/check') return respond(res,404,{error:'not_found'});
    if (req.method!=='GET') return respond(res,405,{error:'method_not_allowed'});
    const token=bearer(req);if(!token) return respond(res,401,{error:'unauthenticated'});
    let principal;
    try {principal=await verifyToken(token);} catch {return respond(res,401,{error:'unauthenticated'});}
    const url=new URL(req.url,'http://localhost');
    if (Array.from(url.searchParams.keys()).some(k=>!['organisation_id','application','action'].includes(k)) || Array.from(url.searchParams.keys()).some(k=>url.searchParams.getAll(k).length!==1)) return respond(res,400,{error:'invalid_parameters'});
    const organisationId=url.searchParams.get('organisation_id');
    const applicationId=url.searchParams.get('application');
    const action=url.searchParams.get('action');
    if (!organisationId || !/^[a-f0-9-]{36}$/i.test(organisationId) || !apps.has(applicationId) || !action || !/^[a-z][a-z0-9:_-]{0,79}$/.test(action)) return respond(res,400,{error:'invalid_parameters'});
    try {
      const decision=await withCentralReadSnapshot(pool, repo=>new CentralAccessService(repo,trust).authorise({principal,organisationId,applicationId,action}));
      if (!decision.allowed) return respond(res,403,{allowed:false,reason:decision.reason});
      // No local account IDs in this public-facing response; those require a mutually-authenticated server-to-server adapter.
      return respond(res,200,{allowed:true,organisationId:decision.organisationId,applicationId:decision.applicationId,role:decision.role,identityId:decision.identityId,revision:{membership:decision.membershipRevision,entitlement:decision.entitlementRevision,link:decision.linkRevision}});
    } catch (e) {logger('central_access_error',e);return respond(res,503,{error:'access_unavailable'});}
  };
}
