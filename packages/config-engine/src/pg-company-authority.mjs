import {companyId,product} from './identifiers.mjs';
import {fail} from './errors.mjs';
/** Server-only company membership and entitlement authority using the canonical
 * PR #46 model. Global Logto admin authority is a separate required gate. */
export function createPgCompanyGrantAuthority({pool,clock=Date.now}={}){
 if(typeof pool?.connect!=='function'||typeof clock!=='function')fail('invalid_authority_pool');
 return async ({operatorSubject,companyId:raw,product:app,operation})=>{
  if(typeof operatorSubject!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(operatorSubject))fail('invalid_operator');
  const id=companyId(raw);product(app);
  if(!['create','transition'].includes(operation))fail('invalid_operation');
  const c=await pool.connect();let active=false;
  try{
   await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
   await c.query('SET LOCAL ROLE titan_config_company_authority_reader');
   await c.query("SET LOCAL statement_timeout = '3000ms'");
   const r=await c.query(`SELECT EXISTS(
    SELECT 1 FROM titan.companies company
    JOIN titan.company_memberships member ON member.company_id=company.id
    JOIN titan.identities operator ON operator.id=member.identity_id
    JOIN titan.application_entitlements entitlement ON entitlement.company_id=company.id
    WHERE company.id=$1::uuid AND company.status='active'
    AND operator.logto_subject=$2 AND operator.status='active'
    AND member.status='active' AND member.role IN ('owner','admin')
    AND (member.expires_at IS NULL OR member.expires_at>$4::timestamptz)
    AND entitlement.application_id=$3 AND entitlement.status='active'
    AND (entitlement.expires_at IS NULL OR entitlement.expires_at>$4::timestamptz)
   ) AS allowed`,[id,operatorSubject,app,new Date(clock()).toISOString()]);
   const allowed=r.rows?.length===1&&r.rows[0].allowed===true;
   await c.query('COMMIT');active=false;return allowed;
  }catch(e){if(active)try{await c.query('ROLLBACK')}catch{}throw e}
  finally{c.release()}
 };
}
