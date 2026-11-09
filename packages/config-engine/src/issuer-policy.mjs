import {fail} from './errors.mjs';
export function issuerPolicy({issuer,audience,clockSkewSeconds=30}={}) {
 let url;
 try{url=new URL(issuer)}catch{fail('invalid_issuer')}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||!url.hostname)fail('invalid_issuer');
 if(typeof audience!=='string'||!audience.startsWith('https://')||audience.length>512)fail('invalid_audience');
 if(!Number.isInteger(clockSkewSeconds)||clockSkewSeconds<0||clockSkewSeconds>120)fail('invalid_skew');
 return Object.freeze({issuer:url.href,audience,clockSkewSeconds});
}
export function assertClaims(claims,policy,nowSeconds){
 if(claims.iss!==policy.issuer||!([].concat(claims.aud??[])).includes(policy.audience)||
  !Number.isFinite(claims.exp)||!Number.isFinite(claims.iat)||
  claims.exp<=nowSeconds-policy.clockSkewSeconds||claims.iat>nowSeconds+policy.clockSkewSeconds||
  claims.exp-claims.iat>3600||
  typeof claims.sub!=='string'||!(/^[a-zA-Z0-9:_-]{1,256}$/).test(claims.sub))fail('unauthorised');
 return claims;
}
