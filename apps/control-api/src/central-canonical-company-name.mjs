/** Trusted company-name resolver during the legacy -> canonical transition.
 * Must use an independent canonical shared-company PostgreSQL connection.
 * A restricted SECURITY DEFINER function resolves a *verified* legacy UUID and
 * Logto organisation ID. All name reads then use canonical company RLS.
 * No browser claims or unverified links can supply the company display name.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createCanonicalCompanyNameProvider({pool}={}){
  if(typeof pool?.connect!=='function')throw new TypeError('canonical company pool required');
  return async function getCompanyName({companyId,logtoOrganisationId}={}){
    if(typeof companyId!=='string'||!UUID.test(companyId)||
      typeof logtoOrganisationId!=='string'||!logtoOrganisationId||
      logtoOrganisationId.length>256||/[\x00-\x1f\x7f]/.test(logtoOrganisationId))
      throw new TypeError('verified company IDs required');
    const client=await pool.connect();
    let begun=false;
    try{
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
      await client.query('SET LOCAL ROLE titan_shared_company_reader');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const resolved=await client.query('SELECT titan.resolve_verified_central_company($1,$2) AS company_id',
        [companyId,logtoOrganisationId]);
      if(resolved.rows.length!==1||typeof resolved.rows[0].company_id!=='string'||
        !UUID.test(resolved.rows[0].company_id))throw Error('unverified legacy company link');
      const canonical=resolved.rows[0].company_id;
      await client.query("SELECT set_config('titan.company_id',$1,true)",[canonical]);
      const result=await client.query(
        "SELECT name FROM titan.companies WHERE id=$1 AND status='active' LIMIT 2",[canonical]);
      if(result.rows.length!==1)throw Error('canonical company not active');
      const name=result.rows[0].name;
      if(typeof name!=='string'||!name.trim()||name.length>160||
        /[\x00-\x1f\x7f]/.test(name))throw Error('invalid canonical company name');
      await client.query('COMMIT');begun=false;
      return name.trim();
    }catch(error){
      if(begun)try{await client.query('ROLLBACK');}catch{/* preserve original */}
      throw error;
    }finally{client.release?.();}
  };
}
