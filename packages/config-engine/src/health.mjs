export async function configurationHealth(pool){
 if(typeof pool?.query!=='function')throw new TypeError('pool required');
 try{const r=await pool.query("SELECT to_regclass('titan_config.definitions') IS NOT NULL AS ready");
  return {ready:r.rows?.[0]?.ready===true};}
 catch{return {ready:false};}
}
