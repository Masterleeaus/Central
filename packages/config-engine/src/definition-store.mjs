import {validateDefinition} from './definition.mjs';
import {fail} from './errors.mjs';
export async function registerDefinition({pool,definition}={}){
 if(typeof pool?.query!=='function')fail('invalid_pool');
 const d=validateDefinition(definition);
 const r=await pool.query(`INSERT INTO titan_config.definitions
  (product,key,owner,value_type,default_value,allowed_values,description)
  VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) ON CONFLICT (product,key) DO NOTHING RETURNING key`,
  [d.product,d.key,d.owner,d.type,JSON.stringify(d.defaultValue),
   d.allowedValues?JSON.stringify(d.allowedValues):null,d.description]);
 if(r.rowCount!==1)fail('definition_exists');
 return d;
}
