/**
 * Read-only trusted launch access. Legacy app identifiers are mapped to their
 * displayed product names until the shared schema migration is adopted.
 * Every decision is taken from a single RLS-scoped repeatable-read snapshot.
 */
import {withCentralReadSnapshot} from '../../../packages/control-plane/dist/index.js';

const APPLICATIONS=Object.freeze({sorted:'field',supercharged:'desk',lms:'academy'});
const validCompany=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validSubject=value=>typeof value==='string' && value.length>0 && value.length<=256 && !/[\r\n\0]/.test(value);
const live=expiry=>!expiry || (Number.isFinite(Date.parse(expiry)) && Date.parse(expiry)>Date.now());
/**
 * The verified Logto subject must come from the host-only server-side session,
 * never an unverified decoded token, request parameter or browser input.
 * getCompanyName is a trusted provider (not an end-user supplied display name).
 * A verified local link is required before a product is shown as launchable.
 */
export function createCentralProductReader({pool,getCompanyName}) {
  if (!pool?.connect || typeof getCompanyName!=='function') throw new TypeError('trusted product reader configuration required');
  return async function readProducts({identityId,companyId}) {
    if (!validSubject(identityId)||!validCompany(companyId)) return {authorised:false};
    return withCentralReadSnapshot(pool,companyId,async repo=>{
      const [identity,company]=await Promise.all([
        repo.identityBySubject(identityId),repo.organisation(companyId)
      ]);
      if (!identity||identity.status!=='active'||!company||company.status!=='active') return {authorised:false};
      const memberships=await repo.memberships(identity.id,companyId);
      // Multiple active memberships are ambiguous and must not be resolved by guesswork.
      const activeMembers=memberships.filter(m=>m.status==='active');
      if(activeMembers.length!==1||!live(activeMembers[0].expiresAt))return {authorised:false};
      const name=await getCompanyName({companyId,logtoOrganisationId:company.logtoOrganisationId});
      if(typeof name!=='string'||!name.trim()||name.length>160)return {authorised:false};
      const products=[];
      for(const [id,applicationId] of Object.entries(APPLICATIONS)){
        const entitlements=await repo.entitlements(companyId,applicationId);
        const grants=entitlements.filter(e=>e.status==='active'||e.status==='trialing');
        if(grants.length!==1||!live(grants[0].expiresAt)){
          products.push({id,status:'denied'});continue;
        }
        const links=await repo.localLinks(identity.id,companyId,applicationId);
        products.push({id,status:links.length===1 && links[0].status==='verified' && Boolean(links[0].localUserId) && Boolean(links[0].localAccountId)?'allowed':'unavailable'});
      }
      return {authorised:true,company:{id:companyId,name},products};
    });
  };
}
