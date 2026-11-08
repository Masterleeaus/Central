/** Trusted, server-only Logto Management API verification boundary.
 * A valid machine-to-machine Management API token must be supplied by an approved backend,
 * NEVER an end-user bearer token or browser header. No mutations are performed here.
 */
export interface LogtoVerifierOptions {
  /** Fixed server administrator-configured Management API origin, not user input. */
  origin: string;
  /** Return a short-lived Management API access token obtained with client credentials. */
  accessToken: () => Promise<string>;
  fetcher?: typeof fetch;
  maxPages?: number;
  /** How long a positive membership result may be reused. Default 30s; 0 disables caching.
   * A removed member can therefore still pass a membership check for up to this long. Max 5 minutes. */
  membershipCacheTtlMs?: number;
  /** Upper bound on cached membership entries (oldest evicted first). Default 1000. */
  membershipCacheMaxEntries?: number;
  /** Injectable clock for tests; milliseconds since epoch. */
  clock?: () => number;
}
const identifier=(v:unknown):v is string => typeof v==='string' && v.length>0 && v.length<=256 && /^[A-Za-z0-9_-]+$/.test(v);
const obj=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
export class LogtoAuthorityError extends Error {constructor(message='Logto authority verification failed'){super(message);this.name='LogtoAuthorityError';}}
export class LogtoManagementVerifier {
  private readonly origin:string;
  private readonly accessToken:()=>Promise<string>;
  private readonly fetcher:typeof fetch;
  private readonly maxPages:number;
  private readonly membershipTtlMs:number;
  private readonly membershipMaxEntries:number;
  private readonly clock:()=>number;
  /** Key `${organisationId}\0${userId}` -> expiry time (ms). Positive results only, so denials always reach Logto. */
  private readonly membershipCache=new Map<string,number>();
  constructor(opts:LogtoVerifierOptions){
    const url=new URL(opts.origin);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('management origin must be an HTTPS origin');
    if(!Number.isInteger(opts.maxPages??25)||(opts.maxPages??25)<1||(opts.maxPages??25)>100) throw new Error('invalid page bound');
    const ttl=opts.membershipCacheTtlMs??30_000;
    if(!Number.isInteger(ttl)||ttl<0||ttl>300_000) throw new Error('invalid membership cache TTL');
    const maxEntries=opts.membershipCacheMaxEntries??1000;
    if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>100_000) throw new Error('invalid membership cache size');
    this.origin=url.origin;
    this.accessToken=opts.accessToken;
    this.fetcher=opts.fetcher??fetch;
    this.maxPages=opts.maxPages??25;
    this.membershipTtlMs=ttl;
    this.membershipMaxEntries=maxEntries;
    this.clock=opts.clock??(()=>Date.now());
  }
  private async get(path:string):Promise<unknown>{
    const token=await this.accessToken();
    if(typeof token!=='string' || token.length<12 || token.length>16384 || /[\r\n]/.test(token)) throw new LogtoAuthorityError('invalid management credential');
    let response:Response;
    try { response=await this.fetcher(`${this.origin}/api${path}`,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)}); }
    catch {throw new LogtoAuthorityError('management request unavailable');}
    if(!response.ok) throw new LogtoAuthorityError('management request rejected');
    try {return await response.json();} catch {throw new LogtoAuthorityError('invalid management response');}
  }
  /** Confirm a Logto identity currently belongs to an independently known organisation.
   * A positive result is reused for at most membershipCacheTtlMs; a cache hit costs zero Logto calls.
   * Cold lookups exhaust pages (up to a configured safe bound); never infer membership from email or profile.
   */
  async assertMembership(logtoUserId:string,logtoOrganisationId:string):Promise<void>{
    if(!identifier(logtoUserId)||!identifier(logtoOrganisationId)) throw new LogtoAuthorityError('invalid identity reference');
    if(this.membershipTtlMs===0) return this.lookupMembership(logtoUserId,logtoOrganisationId);
    const key=`${logtoOrganisationId}\u0000${logtoUserId}`;
    const expiresAt=this.membershipCache.get(key);
    if(expiresAt!==undefined){
      if(expiresAt>this.clock()) return;
      this.membershipCache.delete(key);
    }
    await this.lookupMembership(logtoUserId,logtoOrganisationId);
    this.rememberMembership(key);
  }
  private rememberMembership(key:string):void{
    const now=this.clock();
    if(this.membershipCache.size>=this.membershipMaxEntries){
      for(const [k,exp] of this.membershipCache) if(exp<=now) this.membershipCache.delete(k);
      while(this.membershipCache.size>=this.membershipMaxEntries){
        const oldest=this.membershipCache.keys().next().value;
        if(oldest===undefined) break;
        this.membershipCache.delete(oldest);
      }
    }
    this.membershipCache.set(key,now+this.membershipTtlMs);
  }
  private async lookupMembership(logtoUserId:string,logtoOrganisationId:string):Promise<void>{
    const user=await this.get(`/users/${encodeURIComponent(logtoUserId)}`);
    const organisation=await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}`);
    if(!obj(user)||user.id!==logtoUserId||!obj(organisation)||organisation.id!==logtoOrganisationId) throw new LogtoAuthorityError('identity or organisation not found');
    for(let page=1;page<=this.maxPages;page++){
      const members=await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}/users?page=${page}&page_size=100`);
      if(!Array.isArray(members)||members.length>100||!members.every(x=>obj(x)&&identifier(x.id))) throw new LogtoAuthorityError('invalid organisation membership response');
      if(members.some(x=>x.id===logtoUserId)) return;
      if(members.length<100) throw new LogtoAuthorityError('user not a current organisation member');
    }
    throw new LogtoAuthorityError('membership lookup exceeded safe pagination bound');
  }
  async assertIdentity(logtoUserId:string):Promise<void>{
    if(!identifier(logtoUserId)) throw new LogtoAuthorityError('invalid user reference');
    const user=await this.get(`/users/${encodeURIComponent(logtoUserId)}`);
    if(!obj(user)||user.id!==logtoUserId) throw new LogtoAuthorityError('user not found');
  }
  async assertOrganisation(logtoOrganisationId:string):Promise<void>{
    if(!identifier(logtoOrganisationId)) throw new LogtoAuthorityError('invalid organisation reference');
    const org=await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}`);
    if(!obj(org)||org.id!==logtoOrganisationId) throw new LogtoAuthorityError('organisation not found');
  }
  /** Require at least one exact Logto organisation role ID, fetched at decision time.
   * Does not infer privileges from email, role display names, or local Desk/Field profiles.
   */
  async assertAnyOrganisationRole(logtoUserId:string,logtoOrganisationId:string,allowedRoleIds:readonly string[]):Promise<void>{
    if(!identifier(logtoUserId)||!identifier(logtoOrganisationId)||!Array.isArray(allowedRoleIds)||allowedRoleIds.length<1||allowedRoleIds.length>32||!allowedRoleIds.every(identifier))
      throw new LogtoAuthorityError('invalid organisation role scope');
    const allowed=new Set(allowedRoleIds);
    // Membership is checked on each privileged decision (served from the bounded TTL cache when fresh).
    await this.assertMembership(logtoUserId,logtoOrganisationId);
    for(let page=1;page<=this.maxPages;page++){
      const raw=await this.get(`/organizations/${encodeURIComponent(logtoOrganisationId)}/users/${encodeURIComponent(logtoUserId)}/roles?page=${page}&page_size=100`);
      if(!Array.isArray(raw)||raw.length>100||!raw.every(role=>obj(role)&&identifier(role.id)))
        throw new LogtoAuthorityError('invalid organisation roles response');
      if(raw.some(role=>obj(role)&&typeof role.id==='string'&&allowed.has(role.id)))return;
      if(raw.length<100)throw new LogtoAuthorityError('administrator role not held');
    }
    throw new LogtoAuthorityError('organisation role lookup exceeded safe bound');
  }

}
