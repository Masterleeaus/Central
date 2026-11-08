/** Exact, operator-reviewed OIDC client registration plans. No management mutations.
 * Client IDs are assigned by running Logto, not guessed or seeded by the browser.
 */
export type TitanApp='desk'|'field'|'academy';
export interface OidcApplicationPlan {
  app:TitanApp;
  origin:string;
  redirectUris:readonly string[];
  postLogoutRedirectUris:readonly string[];
  responseType:'code';
  pkce:'S256';
  /** Backend confidential clients must keep their client secret on server. */
  clientType:'traditional';
}
function safeOrigin(s:string):string {
 const u=new URL(s);
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.port)throw Error('invalid application HTTPS origin');
 return u.origin;
}
export function createTitanOidcRegistrationPlans(origins:Record<TitanApp,string>):readonly OidcApplicationPlan[]{
 const apps:readonly TitanApp[]=['desk','field','academy'];
 const selected=apps.map(app=>({app,origin:safeOrigin(origins[app])}));
 if(new Set(selected.map(x=>x.origin)).size!==apps.length)throw Error('applications require distinct origins');
 return selected.map(({app,origin})=>({
  app,origin,redirectUris:[`${origin}/auth/callback`],postLogoutRedirectUris:[`${origin}/`],responseType:'code',pkce:'S256',clientType:'traditional'
 }));
}
