/** Authoritative Central organisation lookup for a verified OIDC subject.
 * Cross-tenant discovery can only execute a narrowly granted PostgreSQL
 * SECURITY DEFINER function; the login role cannot SELECT global memberships.
 * Subsequent selected-company checks run through the normal RLS read snapshot.
 */
import {withCentralReadSnapshot} from '../../../packages/control-plane/dist/index.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SUBJECT=/^[^\s\x00-\x1f\x7f]{1,256}$/u;
const isLive=value=>!value || (Number.isFinite(Date.parse(value)) && Date.parse(value)>Date.now());
function validIdentity(issuer,subject,expected){
  return typeof issuer==='string' && issuer===expected && typeof subject==='string' && SUBJECT.test(subject);
}
/** OIDC issuer is matched literally to the configured verified issuer.
 * getCompanyName is an independently trusted server-side provider (Logto /
 * canonical company registry) and is not permitted to decide eligibility.
 */
export function createCentralCompanyAuthority({pool,issuer,getCompanyName}={}){
  if(!pool?.connect||typeof issuer!=='string'||!issuer.startsWith('https://')||
    typeof getCompanyName!=='function')throw new TypeError('trusted company authority dependencies required');

  async function discover({issuer:actualIssuer,subject}={}){
    if(!validIdentity(actualIssuer,subject,issuer))return [];
    const client=await pool.connect();
    let begun=false;
    try{
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
      await client.query('SET LOCAL ROLE titan_central_discovery');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const result=await client.query(
        'SELECT organisation_id, logto_organisation_id FROM titan.central_eligible_companies($1)',[subject]);
      if(!Array.isArray(result.rows)||result.rows.length>128)throw Error('ambiguous membership discovery');
      const seen=new Set(),seenLogto=new Set(),companies=[];
      for(const row of result.rows){
        if(typeof row.organisation_id!=='string'||!UUID.test(row.organisation_id)||
          typeof row.logto_organisation_id!=='string'||!row.logto_organisation_id||
          seen.has(row.organisation_id.toLowerCase())||seenLogto.has(row.logto_organisation_id))throw Error('invalid membership discovery result');
        seen.add(row.organisation_id.toLowerCase());seenLogto.add(row.logto_organisation_id);
        companies.push({companyId:row.organisation_id,logtoOrganisationId:row.logto_organisation_id});
      }
      await client.query('COMMIT');begun=false;
      return companies;
    }catch(error){
      if(begun)try{await client.query('ROLLBACK');}catch{/* preserve error */}
      throw error;
    }finally{client.release?.();}
  }

  /** A single-company OIDC callback uses IDs only, never labels from the user. */
  async function listEligibleCompanies(identity){
    const companies=await discover(identity);
    return companies.map(company=>({companyId:company.companyId,authorised:true}));
  }

  /** Multi-company UI names come from a trusted provider after discovery. */
  async function listOrganisations(identity){
    const companies=await discover(identity);
    const result=[];
    for(const company of companies){
      const name=await getCompanyName(company);
      if(typeof name!=='string'||!name.trim()||name.length>160||
        /[\x00-\x1f\x7f]/.test(name))throw Error('invalid company name');
      result.push({id:company.companyId,name:name.trim()});
    }
    return result;
  }

  async function recheckCompany({issuer:actualIssuer,subject,companyId}={}){
    if(!validIdentity(actualIssuer,subject,issuer)||typeof companyId!=='string'||!UUID.test(companyId))return false;
    return withCentralReadSnapshot(pool,companyId,async repo=>{
      const identity=await repo.identityBySubject(subject);
      if(!identity||identity.status!=='active')return false;
      const company=await repo.organisation(companyId);
      if(!company||company.status!=='active')return false;
      const all=await repo.memberships(identity.id,companyId);
      const active=all.filter(row=>row.status==='active');
      if(active.length!==1||!isLive(active[0].expiresAt))return false;
      for(const app of ['field','desk','academy']){
        const grants=await repo.entitlements(companyId,app);
        if(grants.some(row=>(row.status==='active'||row.status==='trialing')&&isLive(row.expiresAt)))return true;
      }
      return false;
    });
  }
  return Object.freeze({listEligibleCompanies,listOrganisations,recheckCompany});
}
