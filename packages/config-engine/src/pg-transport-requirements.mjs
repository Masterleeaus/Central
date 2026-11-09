import {fail} from './errors.mjs';
export function assertVerifiedPostgresTransport(uri){
 let url;try{url=new URL(uri)}catch{fail('invalid_database_transport')}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||
 url.searchParams.getAll('sslmode').length!==1||
 url.searchParams.get('sslmode')!=='verify-full'||
 url.searchParams.getAll('sslrootcert').length!==1||
 !url.searchParams.get('sslrootcert')||
 url.searchParams.has('sslkey')||url.searchParams.has('sslcert')||
 url.searchParams.has('ssl')||url.hash)fail('database_tls_verification_required');
 return Object.freeze({hostname:url.hostname,caFile:url.searchParams.get('sslrootcert'),mode:'verify-full'});
}
