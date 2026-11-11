/** Same-origin Central logout. Never accept GET logout, caller-supplied
 * redirects or arbitrary Origin. Revocation is performed in durable storage
 * before issuing the redirect and deletion cookie.
 */
import {clearSessionCookie} from './central-session.mjs';

const headers=Object.freeze({
  'cache-control':'no-store, private',
  'referrer-policy':'no-referrer',
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY'
});
function reply(res,status,body){
  res.writeHead(status,{...headers,'content-type':'text/plain; charset=utf-8'});
  res.end(body);
}
export function createCentralLogoutHandler({sessions,origin}={}){
  let trusted;
  try{trusted=new URL(origin);}catch{throw new TypeError('trusted Central origin required');}
  if(typeof sessions?.revoke!=='function'||trusted.protocol!=='https:'||
    trusted.href!==trusted.origin+'/'||trusted.username||trusted.password)
    throw new TypeError('secure logout configuration required');

  return async function handleLogout(req,res){
    let url;
    try{url=new URL(req.url??'/','http://localhost');}catch{return false;}
    if(url.pathname!=='/auth/central/logout')return false;
    if(req.method!=='POST'){reply(res,405,'Method not allowed');return true;}
    // No user-controlled target URL, request body or query parameters.
    if(url.search||req.headers?.origin!==trusted.origin||
       (req.headers?.['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')||
       (req.headers?.['content-length']&&req.headers['content-length']!=='0')||
       req.headers?.['transfer-encoding']){
      reply(res,403,'Logout rejected');return true;
    }
    try {
      const deletion=await sessions.revoke(req);
      if(deletion!==clearSessionCookie())throw Error('invalid deletion cookie');
      res.writeHead(303,{...headers,location:'/auth/central/start','set-cookie':deletion});
      res.end();
    } catch {
      // Do not claim success if durable revocation fails. No redirect.
      reply(res,503,'Logout unavailable');
    }
    return true;
  };
}
