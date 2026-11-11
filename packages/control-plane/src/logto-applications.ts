/** Read-only OIDC registration verifier. No client secrets or administrative mutations.
 * Source: Logto v1.45.0 packages/core/src/routes/applications/application.ts GET /applications.
 */
import type {OidcApplicationPlan} from './oidc-registration.js';

type FetchLike=typeof fetch;
export interface LogtoApplicationsOptions {
 origin:string;
 accessToken:()=>Promise<string>;
 fetcher?:FetchLike;
 maxPages?:number;
}
export interface RegistrationStatus {
 app:string;
 state:'registered'|'missing'|'mismatch'|'ambiguous';
 applicationId?:string;
 issues:readonly string[];
}
function string(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=512;}
function record(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
const matches=(found:unknown,expected:readonly string[])=>Array.isArray(found)&&found.every(string)&&found.length===expected.length&&expected.every(value=>found.includes(value));
export class LogtoApplicationInspector {
 private readonly origin:string;
 private readonly fetcher:FetchLike;
 private readonly token:()=>Promise<string>;
 private readonly pages:number;
 constructor(opts:LogtoApplicationsOptions){
  const u=new URL(opts.origin);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('invalid management origin');
  if(!Number.isInteger(opts.maxPages??10)||(opts.maxPages??10)<1||(opts.maxPages??10)>100)throw Error('invalid page limit');
  this.origin=u.origin;this.fetcher=opts.fetcher??fetch;this.token=opts.accessToken;this.pages=opts.maxPages??10;
 }
 async inspect(plans:readonly OidcApplicationPlan[], assignedIds:Partial<Record<'desk'|'field'|'academy',string>>):Promise<readonly RegistrationStatus[]>{
  if(plans.length!==3||new Set(plans.map(p=>p.app)).size!==3||plans.some(p=>!['desk','field','academy'].includes(p.app)))throw Error('invalid registration plans');
  // IDs are obtained from a trusted operator, never matched by mutable display names.
  if(Object.values(assignedIds).some(id=>id!==undefined&&(!string(id)||!/^[a-zA-Z0-9_-]{1,256}$/.test(id))))throw Error('invalid assigned client ID');
  const token=await this.token();
  if(!string(token)||token.length>16384||/[\r\n]/.test(token))throw Error('invalid management credential');
  const discovered=new Map<string,Record<string,unknown>[]>();
  let exhausted=false;
  for(let page=1;page<=this.pages;page++){
   let response:Response;
   try {response=await this.fetcher(`${this.origin}/api/applications?page=${page}&page_size=100`,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});}
   catch{throw Error('application registry unavailable');}
   if(!response.ok)throw Error('application registry rejected the request');
   let items:unknown;try{items=await response.json();}catch{throw Error('invalid application registry response');}
   if(!Array.isArray(items)||items.length>100||!items.every(x=>record(x)&&string(x.id)))throw Error('invalid application registry response');
   for(const raw of items){const v=raw as Record<string,unknown>;const id=v.id as string;discovered.set(id,[...(discovered.get(id)??[]),v]);}
   if(items.length<100){exhausted=true;break;}
  }
  if(!exhausted)throw Error('application listing exceeded pagination limit');
  return plans.map(plan=>{
   const id=assignedIds[plan.app];
   if(!id)return {app:plan.app,state:'missing',issues:['no_trusted_client_id']};
   const apps=discovered.get(id)??[];
   if(!apps.length)return {app:plan.app,state:'missing',issues:['client_id_not_found']};
   if(apps.length!==1)return {app:plan.app,state:'ambiguous',issues:['duplicate_client_id']};
   const app=apps[0];const issues:string[]=[];
   if(app.type!=='Traditional')issues.push('unexpected_application_type');
   // Logto responds with oidcClientMetadata; never show it verbatim (may contain secrets).
   const meta=app.oidcClientMetadata;
   if(!record(meta)||!matches(meta.redirectUris,plan.redirectUris))issues.push('redirect_uris_mismatch');
   if(!record(meta)||!matches(meta.postLogoutRedirectUris,plan.postLogoutRedirectUris))issues.push('post_logout_uris_mismatch');
   return {app:plan.app,state:issues.length?'mismatch':'registered',applicationId:id,issues};
  });
 }
}
