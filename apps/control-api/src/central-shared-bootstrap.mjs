/** Staging bridge to canonical company names. The canonical and legacy
 * migration chains currently require separate databases; never point the
 * canonical pool at Central's legacy database. Disabled browser mode does
 * not create this pool.
 */
import {createCanonicalCompanyNameProvider} from './central-canonical-company-name.mjs';

function databaseName(value){
  let url;
  try{url=new URL(value);}catch{throw new TypeError('invalid PostgreSQL connection URL');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||
    !url.pathname||url.pathname==='/'||url.hash)
    throw new TypeError('PostgreSQL database name and host required');
  return decodeURIComponent(url.pathname.slice(1));
}
export function ensureSeparateCanonicalDatabase(legacyUrl,canonicalUrl){
  const legacyName=databaseName(legacyUrl);
  const sharedName=databaseName(canonicalUrl);
  // During transitional staging, force distinct DB names even on different
  // hosts. This prevents accidental schema collisions and misconfigured
  // aliases from pointing both roles at the same database.
  if(legacyName===sharedName)throw new TypeError('canonical database must have a distinct database name');
  return true;
}
export async function createCanonicalCompanySource({legacyUrl,sharedUrl,Pool}={}){
  if(typeof Pool!=='function')throw new TypeError('PostgreSQL Pool required');
  ensureSeparateCanonicalDatabase(legacyUrl,sharedUrl);
  const sharedPool=new Pool({connectionString:sharedUrl,max:3,
    connectionTimeoutMillis:3000,idleTimeoutMillis:10000,
    application_name:'titan-central-canonical-names'});
  try{
    const client=await sharedPool.connect();
    try{
      const result=await client.query(
        "SELECT to_regclass('titan.companies') AS companies, to_regclass('titan.central_legacy_company_links') AS links, to_regprocedure('titan.resolve_verified_central_company(uuid,text)') AS resolver"
      );
      if(result.rows?.length!==1||!result.rows[0].companies||
        !result.rows[0].links||!result.rows[0].resolver)
        throw new Error('canonical mapping schema is not installed');
    }finally{client.release?.();}
    return {sharedPool,getCompanyName:createCanonicalCompanyNameProvider({pool:sharedPool})};
  }catch(error){
    try{await sharedPool.end();}catch{/* startup failure remains authoritative */}
    throw error;
  }
}
