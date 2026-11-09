import {fail} from './errors.mjs';
const roles={config:['titan_config_api_login','titan_config_reader','titan_config_grant_reader'],grants:['titan_config_grants_login','titan_config_grant_reader','titan_config_reader']};
export async function verifyRuntimeLogin(pool,purpose){
 const expected=roles[purpose];
 if(!expected||typeof pool?.connect!=='function')fail('invalid_runtime_login_check');
 const c=await pool.connect();let begun=false;
 try{
  await c.query('BEGIN TRANSACTION READ ONLY');begun=true;
  await c.query("SET LOCAL statement_timeout = '3000ms'");
  const r=await c.query(`SELECT current_user AS session_user_name,
  (SELECT rolsuper OR rolbypassrls OR rolinherit OR rolcreatedb OR rolcreaterole FROM pg_catalog.pg_roles WHERE rolname=current_user) AS privileged,
  pg_has_role(current_user,$1,'MEMBER') AS role_member,
  pg_has_role(current_user,$2,'MEMBER') AS forbidden_member`,expected.slice(1));
  const row=r.rows?.length===1?r.rows[0]:null;
  if(row?.session_user_name!==expected[0]||row?.privileged!==false||
     row?.role_member!==true||row?.forbidden_member!==false)fail('unsafe_runtime_login');
  await c.query('COMMIT');begun=false;
  return Object.freeze({purpose,login:expected[0],verified:true});
 }catch(e){if(begun)try{await c.query('ROLLBACK')}catch{}throw e}
 finally{c.release()}
}
