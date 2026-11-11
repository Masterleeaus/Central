/** Server-side provisioning; this module MUST NOT be called with unverified browser claims.
 * The caller must validate Logto management credentials, actor authority, and consent.
 * Logto remains authoritative for the existence and membership of its organisations.
 * Account links are written only here. Their assertions are verified by TrustedProvisioningService
 * before this class is called (see link-assertion.ts and docs/LINKING.md).
 */
import { createHash } from 'node:crypto';
import type { ApplicationId, MembershipRole } from './contracts.js';
import type { SqlPool, SqlClient, MemberState, GrantState } from './postgres.js';
import { recordActivity } from './activity-events.js';
import type { ActivityEventInput } from './activity-events.js';

export type ProvisioningCommand =
 | { kind:'identity'; id:string; logtoSubject:string }
 | { kind:'organisation'; id:string; logtoOrganisationId:string }
 | { kind:'membership'; id:string; identityId:string; organisationId:string; role:MembershipRole }
 | { kind:'entitlement'; id:string; organisationId:string; applicationId:ApplicationId; features:readonly string[]; expiresAt?:string }
 | { kind:'link'; id:string; identityId:string; organisationId:string; applicationId:ApplicationId; localUserId:string; localAccountId:string; assertion:string }
 | { kind:'link_relink'; id:string; identityId:string; organisationId:string; applicationId:ApplicationId; expectedRevision:number; localUserId:string; localAccountId:string; assertion:string }
 | { kind:'membership_update'; id:string; organisationId:string; expectedRevision:number; role?:MembershipRole; state?:MemberState }
 | { kind:'entitlement_update'; id:string; organisationId:string; expectedRevision:number; state:GrantState; features?:readonly string[]; expiresAt?:string|null }
 | { kind:'link_revoke'; id:string; organisationId:string; expectedRevision:number }
 | LinkReviewResolveCommand;

/** Operator resolution of a link_reviews row (issue #37). `id` is the review ID. Identity, organisation and
 * application are cross-checked against the review row, never trusted from the command alone.
 * approved: creates the link, or relinks the existing row for the identity, organisation and application
 * (expectedRevision required for a relink). The review's local account must be the one supplied.
 * rejected: records the decision only; no link is written. Both need a reason. */
export type LinkReviewResolveCommand = { kind:'link_review_resolve'; id:string; identityId:string; organisationId:string; applicationId:ApplicationId; reason:string } & (
 | { decision:'approved'; expectedRevision?:number; localUserId:string; localAccountId:string; assertion:string }
 | { decision:'rejected' }
);
/** Commands whose link assertion must be verified before they reach CentralProvisioner. */
export type LinkAssertionCommand = Extract<ProvisioningCommand, { kind:'link'|'link_relink' }> | Extract<LinkReviewResolveCommand, { decision:'approved' }>;

type CreateCommand = Extract<ProvisioningCommand, { kind:'identity'|'organisation'|'membership'|'entitlement'|'link' }>;
type LinkCommand = Extract<ProvisioningCommand, { kind:'link' }>;
type RelinkCommand = Extract<ProvisioningCommand, { kind:'link_relink' }>;
type LinkWrite = LinkCommand | RelinkCommand;

/** Why an account link was not written and was recorded for review instead. Fail closed; nothing is auto-resolved. */
export type LinkReviewReason = 'existing_link_other_account' | 'account_claimed_elsewhere' | 'concurrent_conflict';

/** Thrown after the review row and its audit row have committed. The link itself was NOT written. */
export class LinkReviewRequired extends Error {
 constructor(readonly reason:LinkReviewReason, readonly reviewId:string){ super(`account link recorded for review: ${reason}`); this.name='LinkReviewRequired'; }
}
class LinkReviewSignal extends Error {
 constructor(readonly reason:LinkReviewReason){ super(`account link needs review: ${reason}`); this.name='LinkReviewSignal'; }
}

export interface ProvisioningContext {
 /** Immutable ID from server-validated management credential; NEVER a header supplied by the browser. */
 actorSubject: string;
 /** Caller-supplied evidence reference for verification with source authority; NOT proof on its own. */
 authorityReference: string;
 requestId: string;
}
const uuid = (v:unknown):v is string=>typeof v==='string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
const nonempty=(s:unknown,max=256):s is string=>typeof s==='string' && s.length>0 && s.length<=max && s.trim()===s && !/[\x00-\x1f\x7f]/.test(s);
const revision=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>=1;
const roles=new Set(['owner','admin','manager','member','learner']);
const apps=new Set(['field','desk','academy']);
const memberStates=new Set<MemberState>(['active','invited','suspended','revoked']);
const grantStates=new Set<GrantState>(['active','trialing','paused','expired','revoked']);
/** Compact JWS shape only; the signature itself is verified by TrustedProvisioningService. */
const assertionShape=(v:unknown):v is string=>typeof v==='string' && v.length<=4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v);
/** Role rank used only to detect demotion; higher is more privileged. */
const ROLE_RANK: Record<MembershipRole, number> = { learner:0, member:1, manager:2, admin:3, owner:4 };
/** Every application whose sessions must be revoked when a member's access is reduced. */
const SESSION_APPS: readonly ApplicationId[] = ['desk','field','academy'];
const validDate=(d:string|undefined)=>!d || (Number.isFinite(Date.parse(d)) && new Date(d).toISOString()===d);
const validFeatures=(f:unknown):f is readonly string[]=>Array.isArray(f)&&f.length<=100&&f.every(x=>nonempty(x,100))&&new Set(f).size===f.length;
const isoOrNull=(v:unknown):string|null=>{if(v===null||v===undefined) return null;const d=new Date(v as string|Date);if(!Number.isFinite(d.valueOf())) throw Error('invalid stored expiry');return d.toISOString();};
const isCreate=(c:ProvisioningCommand):c is CreateCommand=>c.kind==='identity'||c.kind==='organisation'||c.kind==='membership'||c.kind==='entitlement'||c.kind==='link';
const sameUuid=(a:unknown,b:string)=>String(a).toLowerCase()===b.toLowerCase();
const isUniqueViolation=(e:unknown)=>(e as {code?:unknown})?.code==='23505';
function validate(c:ProvisioningCommand, context:ProvisioningContext):void {
  if(!uuid(context.requestId)||!nonempty(context.actorSubject)||!nonempty(context.authorityReference,500)) throw Error('invalid provisioning authority context');
  if (!uuid(c.id)) throw Error('invalid provisioning identifier');
  switch(c.kind){
    case 'identity': if(!nonempty(c.logtoSubject)) throw Error('invalid identity subject');break;
    case 'organisation':if(!nonempty(c.logtoOrganisationId)) throw Error('invalid organisation subject');break;
    case 'membership':if(!uuid(c.identityId)||!uuid(c.organisationId)||!roles.has(c.role)) throw Error('invalid membership');break;
    case 'entitlement':if(!uuid(c.organisationId)||!apps.has(c.applicationId)||!Array.isArray(c.features)||c.features.length>100||!c.features.every(f=>nonempty(f,100))||new Set(c.features).size!==c.features.length||!validDate(c.expiresAt)) throw Error('invalid entitlement');break;
    case 'link':
    case 'link_relink':
      if(!uuid(c.identityId)||!uuid(c.organisationId)||!apps.has(c.applicationId)||!nonempty(c.localUserId)||!nonempty(c.localAccountId)||!assertionShape(c.assertion)
        ||(c.kind==='link_relink'&&!revision(c.expectedRevision))) throw Error('invalid account link');
      break;
    case 'membership_update':
      if(!uuid(c.organisationId)||!revision(c.expectedRevision)||(c.role===undefined&&c.state===undefined)||(c.role!==undefined&&!roles.has(c.role))||(c.state!==undefined&&!memberStates.has(c.state))) throw Error('invalid membership update');break;
    case 'entitlement_update':
      if(!uuid(c.organisationId)||!revision(c.expectedRevision)||!grantStates.has(c.state)) throw Error('invalid entitlement update');
      if(c.features!==undefined&&!validFeatures(c.features)) throw Error('invalid entitlement update');
      if(c.expiresAt!==undefined&&c.expiresAt!==null&&!(typeof c.expiresAt==='string'&&validDate(c.expiresAt))) throw Error('invalid entitlement update');
      break;
    case 'link_revoke':
      if(!uuid(c.organisationId)||!revision(c.expectedRevision)) throw Error('invalid link revocation');break;
    case 'link_review_resolve':
      if(!uuid(c.identityId)||!uuid(c.organisationId)||!apps.has(c.applicationId)||!nonempty(c.reason,500)) throw Error('invalid link review resolution');
      if(c.decision==='approved'){
        if(!nonempty(c.localUserId)||!nonempty(c.localAccountId)||!assertionShape(c.assertion)||(c.expectedRevision!==undefined&&!revision(c.expectedRevision))) throw Error('invalid link review resolution');
      } else if(c.decision!=='rejected') throw Error('invalid link review resolution');
      break;
    default:throw Error('unsupported provisioning command');
  }
}

/** Exactly one transaction and one audit event per idempotency key.
 * Conflicts never mutate another identity's mapping. Replays return the original result.
 * Reductions of access (suspend, demote, revoke, unlink, relink) bump the session revocation generation
 * in the same transaction as the row change and the audit record.
 * Ambiguous account-link cases commit a review row and an audit row, change no link, and throw LinkReviewRequired.
 */
export class CentralProvisioner {
 constructor(private readonly pool:SqlPool){}
 async apply(context:ProvisioningContext, command:ProvisioningCommand):Promise<'created'|'updated'|'replayed'> {
  validate(command,context);
  const conn=await this.pool.connect(); let begun=false;
  try {
   await conn.query('BEGIN'); begun=true;
   // Cross-tenant writes run only as titan_trusted_writer (migrations 0006-0008); the login role does not inherit them.
   await conn.query('SET LOCAL ROLE titan_trusted_writer');
   await conn.query("SET LOCAL statement_timeout = '5000ms'");
   // Serialize the exact request ID; request idempotence is protected by the DB unique constraint.
   await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[context.requestId]);
   const previous=await conn.query('SELECT command_kind, command_digest FROM titan.provisioning_audit WHERE request_id=$1',[context.requestId]);
   const digest=stableDigest(command);
   if(previous.rows.length){
    if(previous.rows.length!==1||previous.rows[0].command_kind!==command.kind||previous.rows[0].command_digest!==digest) throw Error('provisioning request ID reused with different payload');
    await conn.query('COMMIT');begun=false;return 'replayed';
   }
   let outcome:'created'|'updated'|'replayed';
   try {
    outcome = isCreate(command) ? (await insertProvisioning(conn,command), 'created')
     : command.kind==='link_review_resolve' ? await resolveLinkReview(conn,context,command)
     : (await applyUpdate(conn,command), 'updated');
   } catch (e) {
    if(!(e instanceof LinkReviewSignal)) throw e;
    // Fail closed: the link is not written. The review and the audit record commit, then the caller is told.
    // Only link and link_relink can raise LinkReviewSignal, so the command has the link fields.
    const link=command as LinkWrite;
    const review=await conn.query('INSERT INTO titan.link_reviews (request_id,identity_id,organisation_id,application_id,local_account_id,reason,command_kind) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
     [context.requestId,link.identityId,link.organisationId,link.applicationId,link.localAccountId,e.reason,link.kind]);
    await conn.query('INSERT INTO titan.provisioning_audit(request_id,actor_subject,authority_reference,command_kind,command_digest,subject_id) VALUES ($1,$2,$3,$4,$5,$6)',[context.requestId,context.actorSubject,context.authorityReference,command.kind,digest,command.id]);
    await conn.query('COMMIT');begun=false;
    throw new LinkReviewRequired(e.reason,String(review.rows[0]?.id??''));
   }
   if(command.kind==='link_review_resolve') await conn.query('INSERT INTO titan.provisioning_audit(request_id,actor_subject,authority_reference,command_kind,command_digest,subject_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',[context.requestId,context.actorSubject,context.authorityReference,command.kind,digest,command.id,command.reason]);
   else await conn.query('INSERT INTO titan.provisioning_audit(request_id,actor_subject,authority_reference,command_kind,command_digest,subject_id) VALUES ($1,$2,$3,$4,$5,$6)',[context.requestId,context.actorSubject,context.authorityReference,command.kind,digest,command.id]);
   // Activity history (issue #36): same transaction, so a refused event rolls back the lifecycle change.
   const activity=activityFor(command,context);
   if(activity) await recordActivity(conn,activity);
   await conn.query('COMMIT');begun=false;return outcome;
  }catch(e){if(begun){try{await conn.query('ROLLBACK')}catch{/* retain original exception */}}throw e;}
  finally{conn.release?.();}
 }
 /** True only when this exact request (same ID and same digest) was already applied. Reads the audit row and
 * writes nothing. TrustedProvisioningService calls it before assertion verification, so an identical retry of an
 * applied resolution is answered 'replayed' without spending a second nonce. A reused ID with another payload throws. */
 async wasApplied(context:ProvisioningContext, command:ProvisioningCommand):Promise<boolean> {
  validate(command,context);
  const conn=await this.pool.connect(); let begun=false;
  try {
   await conn.query('BEGIN'); begun=true;
   await conn.query('SET LOCAL ROLE titan_trusted_writer');
   await conn.query("SET LOCAL statement_timeout = '5000ms'");
   const previous=await conn.query('SELECT command_kind, command_digest FROM titan.provisioning_audit WHERE request_id=$1',[context.requestId]);
   await conn.query('COMMIT'); begun=false;
   if(!previous.rows.length) return false;
   if(previous.rows.length!==1||previous.rows[0].command_kind!==command.kind||previous.rows[0].command_digest!==stableDigest(command)) throw Error('provisioning request ID reused with different payload');
   return true;
  }catch(e){if(begun){try{await conn.query('ROLLBACK')}catch{/* retain original exception */}}throw e;}
  finally{conn.release?.();}
 }
}
/** Resolves a review row inside the caller's transaction. Approval reuses the create and relink rules of this module
 * (same locks, same revision guard, same session revocation). Every conflict throws a plain error, so the transaction
 * rolls back and the review stays open; nothing here records a new review. */
async function resolveLinkReview(conn:SqlClient,context:ProvisioningContext,c:LinkReviewResolveCommand):Promise<'created'|'updated'|'replayed'>{
 const locked=await conn.query('SELECT identity_id, organisation_id, application_id, local_account_id, state FROM titan.link_reviews WHERE id=$1 FOR UPDATE',[c.id]);
 const review=locked.rows[0];
 if(!review) throw Error('link review not found');
 if(!sameUuid(review.identity_id,c.identityId)||!sameUuid(review.organisation_id,c.organisationId)||String(review.application_id)!==c.applicationId) throw Error('link review identity, organisation or application mismatch');
 if(c.decision==='approved'&&String(review.local_account_id)!==c.localAccountId) throw Error('link review local account mismatch');
 const state=String(review.state);
 if(state!=='open'){
  if(state===c.decision) return 'replayed';
  throw Error('link review already resolved with a different decision');
 }
 const resolution=await conn.query("UPDATE titan.link_reviews SET state=$2, resolved_at=now(), resolved_by=$3, resolution_reason=$4, resolution_request_id=$5 WHERE id=$1 AND state='open'",[c.id,c.decision,context.actorSubject,c.reason,context.requestId]);
 if(resolution.rowCount!==1) throw Error('link review changed during resolution');
 if(c.decision==='rejected') return 'updated';
 const same=await conn.query('SELECT l.id, l.state, l.local_account_id, l.revision, i.logto_subject FROM titan.local_account_links l JOIN titan.identities i ON i.id=l.identity_id WHERE l.identity_id=$1 AND l.organisation_id=$2 AND l.application_id=$3 FOR UPDATE OF l',[c.identityId,c.organisationId,c.applicationId]);
 if(same.rows.length>1) throw Error('ambiguous account link for identity and application');
 const row=same.rows[0];
 if(!row){
  if(c.expectedRevision!==undefined) throw Error('revision conflict: no account link exists to relink');
  const claimed=await conn.query("SELECT id FROM titan.local_account_links WHERE application_id=$1 AND local_account_id=$2 AND state='verified' FOR UPDATE",[c.applicationId,c.localAccountId]);
  if(claimed.rows.length>0) throw Error('local account is still verified for another link: resolve that link first');
  const inserted=await conn.query("INSERT INTO titan.local_account_links(id,identity_id,organisation_id,application_id,local_user_id,local_account_id,state,verified_at) VALUES ($1,$2,$3,$4,$5,$6,'verified',now()) ON CONFLICT DO NOTHING RETURNING id",[c.id,c.identityId,c.organisationId,c.applicationId,c.localUserId,c.localAccountId]);
  if(inserted.rowCount!==1) throw Error('concurrent account link write: review again');
  return 'created';
 }
 if(c.expectedRevision===undefined||Number(row.revision)!==c.expectedRevision) throw Error('revision conflict: account link missing or changed');
 if(String(row.state)==='verified'&&String(row.local_account_id)===c.localAccountId) throw Error('relink target is the current account');
 const claimed=await conn.query("SELECT id FROM titan.local_account_links WHERE application_id=$1 AND local_account_id=$2 AND state='verified' AND id<>$3 FOR UPDATE",[c.applicationId,c.localAccountId,row.id]);
 if(claimed.rows.length>0) throw Error('local account is still verified for another link: resolve that link first');
 let updated;
 try {
  updated=await conn.query("UPDATE titan.local_account_links SET local_user_id=$3, local_account_id=$4, state='verified', verified_at=now(), revision=revision+1 WHERE id=$1 AND revision=$2",[row.id,c.expectedRevision,c.localUserId,c.localAccountId]);
 } catch (e) {
  if(isUniqueViolation(e)) throw Error('concurrent account link write: review again');
  throw e;
 }
 if(updated.rowCount!==1) throw Error('revision conflict: account link changed');
 await bumpGeneration(conn,c.applicationId,String(row.logto_subject),c.organisationId);
 return 'updated';
}
/** Maps a provisioning command to its activity event. Detail holds enum values and application IDs only.
 * An identity has no organisation, and the activity table is tenant-keyed, so identity creation records no
 * activity event. The audit row still records it. */
function activityFor(c:ProvisioningCommand,context:ProvisioningContext):ActivityEventInput|undefined{
 const base={actorKind:'subject' as const,actorId:context.actorSubject,sourceProduct:'central' as const,outcome:'success' as const,correlationId:context.requestId};
 switch(c.kind){
  case 'identity': return undefined;
  case 'organisation': return {...base,organisationId:c.id,action:'organisation.create',targetType:'organisation',targetId:c.id};
  case 'membership': return {...base,organisationId:c.organisationId,action:'membership.create',targetType:'membership',targetId:c.id,detail:{role:c.role}};
  case 'entitlement': return {...base,organisationId:c.organisationId,action:'entitlement.create',targetType:'entitlement',targetId:c.id,detail:{applicationId:c.applicationId}};
  case 'link': return {...base,organisationId:c.organisationId,action:'account_link.create',targetType:'account_link',targetId:c.id,detail:{applicationId:c.applicationId}};
  case 'membership_update': return {...base,organisationId:c.organisationId,action:'membership.update',targetType:'membership',targetId:c.id,detail:{...(c.role!==undefined?{role:c.role}:{}),...(c.state!==undefined?{state:c.state}:{})}};
  case 'entitlement_update': return {...base,organisationId:c.organisationId,action:'entitlement.update',targetType:'entitlement',targetId:c.id,detail:{state:c.state}};
  case 'link_revoke': return {...base,organisationId:c.organisationId,action:'account_link.revoke',targetType:'account_link',targetId:c.id};
  case 'link_review_resolve': return {...base,organisationId:c.organisationId,action:'link_review.resolve',targetType:'link_review',targetId:c.id,detail:{decision:c.decision}};
 }
}
/** Replay digest: the assertion is replaced by its SHA-256, so no signed token is stored in the audit table. */
/** Consistent serialized payload for replay detection; no cryptographic claims: stored audit text is not a signature. */
function stableDigest(command:ProvisioningCommand):string {
 const source:Record<string,unknown>={...command};
 if('assertion' in command){delete source.assertion;source.assertionSha256=createHash('sha256').update(command.assertion).digest('hex');}
 const sorted=Object.fromEntries(Object.entries(source).sort(([a],[b])=>a.localeCompare(b)));
 return JSON.stringify(sorted);
}
async function insertProvisioning(conn:SqlClient,c:CreateCommand):Promise<void>{
 if(c.kind==='link'){await createLink(conn,c);return;}
 let result;
 switch(c.kind){
  case 'identity': result=await conn.query("INSERT INTO titan.identities (id,logto_subject,state) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING RETURNING id",[c.id,c.logtoSubject]);break;
  case 'organisation':result=await conn.query("INSERT INTO titan.organisations (id,logto_organisation_id,state) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING RETURNING id",[c.id,c.logtoOrganisationId]);break;
  case 'membership':result=await conn.query("INSERT INTO titan.memberships(id,identity_id,organisation_id,role,state) VALUES ($1,$2,$3,$4,'active') ON CONFLICT DO NOTHING RETURNING id",[c.id,c.identityId,c.organisationId,c.role]);break;
  case 'entitlement':result=await conn.query("INSERT INTO titan.entitlements(id,organisation_id,application_id,state,features,expires_at) VALUES ($1,$2,$3,'active',$4,$5) ON CONFLICT DO NOTHING RETURNING id",[c.id,c.organisationId,c.applicationId,c.features,c.expiresAt??null]);break;
 }
 if(result?.rowCount!==1) throw Error('provisioning conflict: existing record requires explicit review');
}

/** Create a verified link. Existing rows for the identity, organisation and application are never overwritten.
 * A local account already verified for another identity or organisation is ambiguous and goes to review. */
async function createLink(conn:SqlClient,c:LinkCommand):Promise<void>{
 const same=await conn.query('SELECT state, local_account_id FROM titan.local_account_links WHERE identity_id=$1 AND organisation_id=$2 AND application_id=$3 FOR UPDATE',[c.identityId,c.organisationId,c.applicationId]);
 if(same.rows.length>0){
  if(String(same.rows[0].state)==='verified'&&String(same.rows[0].local_account_id)!==c.localAccountId) throw new LinkReviewSignal('existing_link_other_account');
  throw Error('provisioning conflict: existing link requires explicit relink or unlink');
 }
 const claimed=await conn.query("SELECT id FROM titan.local_account_links WHERE application_id=$1 AND local_account_id=$2 AND state='verified' FOR UPDATE",[c.applicationId,c.localAccountId]);
 if(claimed.rows.length>0) throw new LinkReviewSignal('account_claimed_elsewhere');
 // ON CONFLICT DO NOTHING without a target also absorbs a concurrent insert that won the unique index race.
 const result=await conn.query("INSERT INTO titan.local_account_links(id,identity_id,organisation_id,application_id,local_user_id,local_account_id,state,verified_at) VALUES ($1,$2,$3,$4,$5,$6,'verified',now()) ON CONFLICT DO NOTHING RETURNING id",[c.id,c.identityId,c.organisationId,c.applicationId,c.localUserId,c.localAccountId]);
 if(result.rowCount!==1) throw new LinkReviewSignal('concurrent_conflict');
}

/** Update and revoke commands. Each row is locked with FOR UPDATE, the expected revision is
 * compared, and the revision is advanced by the same statement that changes the state. */
async function applyUpdate(conn:SqlClient,c:Exclude<ProvisioningCommand,CreateCommand>):Promise<void>{
 switch(c.kind){
  case 'membership_update': {
   const locked=await conn.query('SELECT m.organisation_id, m.role, m.state, m.revision, i.logto_subject FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.id=$1 FOR UPDATE OF m',[c.id]);
   const current=locked.rows[0];
   if(!current||Number(current.revision)!==c.expectedRevision) throw Error('revision conflict: membership missing or changed');
   if(String(current.organisation_id)!==c.organisationId) throw Error('organisation mismatch: membership belongs to another organisation');
   const currentRole=String(current.role) as MembershipRole;
   const nextRole=c.role??currentRole;
   const nextState=c.state??String(current.state) as MemberState;
   const updated=await conn.query('UPDATE titan.memberships SET role=$3, state=$4, revision=revision+1 WHERE id=$1 AND revision=$2',[c.id,c.expectedRevision,nextRole,nextState]);
   if(updated.rowCount!==1) throw Error('revision conflict: membership changed');
   const reduced=nextState!=='active'||ROLE_RANK[nextRole]<ROLE_RANK[currentRole];
   if(reduced) for(const app of SESSION_APPS) await bumpGeneration(conn,app,String(current.logto_subject),String(current.organisation_id));
   return;
  }
  case 'entitlement_update': {
   const locked=await conn.query('SELECT organisation_id, application_id, revision, features, expires_at FROM titan.entitlements WHERE id=$1 FOR UPDATE',[c.id]);
   const current=locked.rows[0];
   if(!current||Number(current.revision)!==c.expectedRevision) throw Error('revision conflict: entitlement missing or changed');
   if(String(current.organisation_id)!==c.organisationId) throw Error('organisation mismatch: entitlement belongs to another organisation');
   const currentFeatures=Array.isArray(current.features)?current.features.map(String):[];
   const currentExpiry=isoOrNull(current.expires_at);
   const nextFeatures=c.features!==undefined?[...c.features]:currentFeatures;
   const nextExpiry=c.expiresAt!==undefined?(c.expiresAt??null):currentExpiry;
   const updated=await conn.query('UPDATE titan.entitlements SET state=$3, features=$4, expires_at=$5, revision=revision+1 WHERE id=$1 AND revision=$2',[c.id,c.expectedRevision,c.state,nextFeatures,nextExpiry]);
   if(updated.rowCount!==1) throw Error('revision conflict: entitlement changed');
   // A reduction is a state move out of access, a removed feature, or an expiry that moved earlier
   // (or became finite). Each one revokes sessions for this application in this transaction.
   const removedFeature=currentFeatures.some(f=>!nextFeatures.includes(f));
   const expiryReduced=nextExpiry!==null&&(currentExpiry===null||Date.parse(nextExpiry)<Date.parse(currentExpiry));
   if(c.state!=='active'&&c.state!=='trialing'||removedFeature||expiryReduced){
    const app=String(current.application_id) as ApplicationId;
    const members=await conn.query('SELECT i.logto_subject, m.organisation_id FROM titan.memberships m JOIN titan.identities i ON i.id=m.identity_id WHERE m.organisation_id=$1',[String(current.organisation_id)]);
    for(const row of members.rows) await bumpGeneration(conn,app,String(row.logto_subject),String(row.organisation_id));
   }
   return;
  }
  case 'link_relink': {
   // Explicit relink of an existing link (verified or revoked) to a different local account. Requires the expected revision.
   const locked=await conn.query('SELECT l.identity_id, l.organisation_id, l.application_id, l.local_account_id, l.state, l.revision, i.logto_subject FROM titan.local_account_links l JOIN titan.identities i ON i.id=l.identity_id WHERE l.id=$1 FOR UPDATE OF l',[c.id]);
   const current=locked.rows[0];
   if(!current||Number(current.revision)!==c.expectedRevision) throw Error('revision conflict: account link missing or changed');
   if(!sameUuid(current.organisation_id,c.organisationId)) throw Error('organisation mismatch: account link belongs to another organisation');
   if(!sameUuid(current.identity_id,c.identityId)||String(current.application_id)!==c.applicationId) throw Error('account link identity or application mismatch');
   if(String(current.state)==='verified'&&String(current.local_account_id)===c.localAccountId) throw Error('relink target is the current account');
   const claimed=await conn.query("SELECT id FROM titan.local_account_links WHERE application_id=$1 AND local_account_id=$2 AND state='verified' AND id<>$3 FOR UPDATE",[c.applicationId,c.localAccountId,c.id]);
   if(claimed.rows.length>0) throw new LinkReviewSignal('account_claimed_elsewhere');
   await conn.query('SAVEPOINT link_write');
   let updated;
   try {
    updated=await conn.query("UPDATE titan.local_account_links SET local_user_id=$3, local_account_id=$4, state='verified', verified_at=now(), revision=revision+1 WHERE id=$1 AND revision=$2",[c.id,c.expectedRevision,c.localUserId,c.localAccountId]);
   } catch (e) {
    if(!isUniqueViolation(e)) throw e;
    await conn.query('ROLLBACK TO SAVEPOINT link_write');
    throw new LinkReviewSignal('concurrent_conflict');
   }
   if(updated.rowCount!==1) throw Error('revision conflict: account link changed');
   // The account a session was issued for has changed (or was re-established): revoke sessions for this subject and app.
   await bumpGeneration(conn,String(current.application_id) as ApplicationId,String(current.logto_subject),String(current.organisation_id));
   return;
  }
  case 'link_revoke': {
   const locked=await conn.query('SELECT l.organisation_id, l.application_id, l.state, l.revision, i.logto_subject FROM titan.local_account_links l JOIN titan.identities i ON i.id=l.identity_id WHERE l.id=$1 FOR UPDATE OF l',[c.id]);
   const current=locked.rows[0];
   if(!current||Number(current.revision)!==c.expectedRevision) throw Error('revision conflict: account link missing or changed');
   if(String(current.organisation_id)!==c.organisationId) throw Error('organisation mismatch: account link belongs to another organisation');
   if(current.state!=='verified') throw Error('account link is not verified');
   const updated=await conn.query("UPDATE titan.local_account_links SET state='revoked', revision=revision+1 WHERE id=$1 AND revision=$2 AND state='verified'",[c.id,c.expectedRevision]);
   if(updated.rowCount!==1) throw Error('revision conflict: account link changed');
   await bumpGeneration(conn,String(current.application_id) as ApplicationId,String(current.logto_subject),String(current.organisation_id));
   return;
  }
 }
}

/** Advances the session revocation generation for one application, subject and organisation.
 * Runs on the caller's transaction so a failure rolls back the row change and the audit record. */
async function bumpGeneration(conn:SqlClient,applicationId:ApplicationId,logtoSubject:string,organisationId:string):Promise<void>{
 const result=await conn.query(`INSERT INTO titan.titan_session_revocations (application_id,logto_subject,organisation_id,generation)
VALUES ($1,$2,$3,1) ON CONFLICT (application_id,logto_subject,organisation_id)
DO UPDATE SET generation=titan_session_revocations.generation+1,revoked_at=now()
RETURNING generation`,[applicationId,logtoSubject,organisationId]);
 const value=Number(result.rows[0]?.generation);
 if(!Number.isSafeInteger(value)||value<1) throw Error('revocation not confirmed');
}
