import {fail} from './errors.mjs';
export async function assertRestrictedRole(client,expected){
 if(!['titan_config_reader','titan_config_writer'].includes(expected))fail('invalid_database_role');
 const result=await client.query(`SELECT current_user AS role,
 (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged`);
 if(result.rows?.length!==1||result.rows[0].role!==expected||
    result.rows[0].privileged!==false)fail('unsafe_database_role');
}
