/** Off by default. Dedicated service secret for Skilled; never use a user's OIDC token. */
const TOKEN=/^[A-Za-z0-9_.-]{32,1024}$/;
const ISSUER=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password;}catch{return false}};
export function readServiceDecisionConfig(env){
 const token=env.TITAN_SKILLED_DECISION_BEARER;
 if(token===undefined||token==='')return null;
 if(!TOKEN.test(token)||!ISSUER(env.TITAN_OIDC_ISSUER)||typeof env.TITAN_ACADEMY_AUDIENCE!=='string'||
   !env.TITAN_ACADEMY_AUDIENCE||env.TITAN_ACADEMY_AUDIENCE.length>200)
  throw Error('Invalid Skilled decision endpoint configuration');
 return {token,issuer:env.TITAN_OIDC_ISSUER,audience:env.TITAN_ACADEMY_AUDIENCE};
}
