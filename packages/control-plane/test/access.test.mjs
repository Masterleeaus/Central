import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralAccessService, makeOidcRedirect, allApplications, linkFromVerifiedAssertion } from '../dist/index.js';
const now='2026-11-02T12:00:00Z';
const fixture=()=>({
 identity:{id:'ti-1',logtoSubject:'logto-1',status:'active'},
 organisation:{id:'org-1',logtoOrganisationId:'lo-1',status:'active'},
 memberships:[{id:'m-1',identityId:'ti-1',organisationId:'org-1',role:'admin',status:'active',revision:1}],
 entitlements:[{id:'e-1',organisationId:'org-1',applicationId:'sorted',status:'active',features:['jobs:read'],revision:1}],
 links:[{id:'l-1',identityId:'ti-1',organisationId:'org-1',applicationId:'sorted',localUserId:'fu-1',localAccountId:'fa-1',status:'verified',verifiedAt:now,revision:1}]
});
const principal={logtoSubject:'logto-1',issuer:'https://auth.titan.test/oidc',audience:'field-client',verifiedAt:now};
const trust={expectedIssuer:principal.issuer,audienceByApplication:{sorted:'field-client',supercharged:'desk-client',lms:'academy-client'}};
function setup(changer=()=>{}){let d=fixture();changer(d);const repo={identityBySubject:async s=>d.identity.logtoSubject===s?d.identity:undefined,organisation:async id=>d.organisation.id===id?d.organisation:undefined,memberships:async (id,org)=>d.memberships.filter(m=>m.identityId===id&&m.organisationId===org),entitlements:async (org,app)=>d.entitlements.filter(e=>e.organisationId===org&&e.applicationId===app),localLinks:async (id,org,app)=>d.links.filter(l=>l.identityId===id&&l.organisationId===org&&l.applicationId===app)};return new CentralAccessService(repo,trust)}
const req=(changes={})=>({principal,organisationId:'org-1',applicationId:'sorted',action:'jobs:read',now,...changes});
async function deny(name,mutate,request,reason){test(name,async()=>{const decision=await setup(mutate)( ).authorise(req(request));assert.deepEqual(decision,{allowed:false,reason});});}
// The following helper avoids coupling assertions to private implementation details.
test('valid membership with entitlement and link allows only resolved local account',async()=>{let result=await setup().authorise(req());assert.equal(result.allowed,true);assert.equal(result.localAccountId,'fa-1');assert.equal(result.localUserId,'fu-1');});
const denied=[
 ['wrong issuer',()=>{}, {principal:{...principal,issuer:'https://evil.invalid'}},'untrusted_issuer'],
 ['wrong audience',()=>{}, {principal:{...principal,audience:'desk-client'}},'untrusted_audience'],
 ['unknown subject',()=>{}, {principal:{...principal,logtoSubject:'someone-else'}},'identity_inactive'],
 ['blocked identity',d=>d.identity.status='blocked',{},'identity_inactive'],
 ['suspended organisation',d=>d.organisation.status='suspended',{},'organisation_inactive'],
 ['revoked membership',d=>d.memberships[0].status='revoked',{},'membership_missing'],
 ['expired membership',d=>d.memberships[0].expiresAt='2026-11-01T00:00:00Z',{},'membership_expired'],
 ['missing membership',d=>d.memberships=[],{},'membership_missing'],
 ['expired entitlement',d=>d.entitlements[0].expiresAt='2026-11-01T00:00:00Z',{},'entitlement_expired'],
 ['paused entitlement',d=>d.entitlements[0].status='paused',{},'entitlement_missing'],
 ['missing entitlement',d=>d.entitlements=[],{},'entitlement_missing'],
 ['role denied',d=>d.memberships[0].role='learner',{},'role_denied'],
 ['feature denied',d=>d.entitlements[0].features=[],{},'feature_denied'],
 ['missing link',d=>d.links=[],{},'link_missing'],
 ['revoked link',d=>d.links[0].status='revoked',{},'link_unverified'],
 ['ambiguous link',d=>d.links.push({...d.links[0],id:'l-2'}),{},'link_ambiguous'],
 ['no local user',d=>d.links[0].localUserId='',{},'link_unverified'],
 ['arbitrary tenant',()=>{}, {organisationId:'org-2'},'organisation_inactive'],
 ['supercharged access cannot reuse sorted entitlement',()=>{}, {applicationId:'supercharged'},'untrusted_audience'],
];
for (const [name,mutate,request,expected] of denied) test(name,async()=>assert.deepEqual(await setup(mutate).authorise(req(request)),{allowed:false,reason:expected}));
test('OIDC registrations cover all three apps with unique client env keys',()=>{const apps=allApplications();assert.deepEqual(apps.map(a=>a.id),['sorted','supercharged','lms']);assert.equal(new Set(apps.map(a=>a.oidcClientIdEnv)).size,3);});
test('redirect URI rejects insecure origins',()=>{assert.equal(makeOidcRedirect('https://field.titanzero.io/','sorted'),'https://field.titanzero.io/auth/callback');for(const url of ['http://field.titanzero.io/','https://field.titanzero.io/bad','https://user:secret@field.titanzero.io/'])assert.throws(()=>makeOidcRedirect(url,'sorted'));});
test('signed/verified local link assertion must be recent',()=>{const a={identityId:'ti-1',organisationId:'org-1',applicationId:'sorted',localUserId:'user-1',localAccountId:'account-1',verifiedBy:'field-api',assertedAt:now};assert.equal(linkFromVerifiedAssertion('link-1',a,now).status,'verified');assert.throws(()=>linkFromVerifiedAssertion('link-1',{...a,assertedAt:'2026-01-01T00:00:00Z'},now));});
