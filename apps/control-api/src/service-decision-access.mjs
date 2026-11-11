/** Reuses CentralAccessService and the existing tenant RLS snapshot for every decision. */
import {CentralAccessService,withCentralReadSnapshot} from '../../../packages/control-plane/dist/index.js';
export function createSkilledDecisionAccess({pool,issuer,audience}){
 if(!pool||typeof issuer!=='string'||typeof audience!=='string')throw TypeError('Central decision DB dependencies required');
 const trust={expectedIssuer:issuer,audienceByApplication:{field:'not-used-field',desk:'not-used-desk',academy:audience}};
 return async({organisationId,subject})=>withCentralReadSnapshot(pool,organisationId,async repo=>{
  const org=await repo.organisation(organisationId);
  if(!org||org.status!=='active'||!org.logtoOrganisationId)return null;
  const decision=await new CentralAccessService(repo,trust).authorise({
   principal:{issuer,audience,logtoSubject:subject,verifiedAt:new Date().toISOString()},
   organisationId,applicationId:'academy',action:'session:open',
  });
  if(!decision.allowed)return null;
  return {allowed:true,applicationId:'academy',organisationId:org.logtoOrganisationId,
   localUserId:decision.localUserId,localAccountId:decision.localAccountId,
   membershipRevision:decision.membershipRevision,
   entitlementRevision:decision.entitlementRevision,linkRevision:decision.linkRevision};
 });
}
