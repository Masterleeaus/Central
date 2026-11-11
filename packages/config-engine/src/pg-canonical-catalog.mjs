import {assertCanonicalSchema} from './canonical-schema-contract.mjs';
import {fail} from './errors.mjs';
/** Reads structure only: no company row data, no database mutation. */
export async function inspectCanonicalSchema(client){
 if(typeof client?.query!=='function')fail('invalid_schema_connection');
 const tables=await client.query(`SELECT n.nspname||'.'||c.relname AS relation FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('titan','titan_config') AND c.relkind IN ('r','p')`);
 const keys=await client.query(`SELECT n.nspname||'.'||c.relname AS table_name,
 a.attname AS column_name, tn.nspname||'.'||tc.relname AS target_name
 FROM pg_catalog.pg_constraint k
 JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_class tc ON tc.oid=k.confrelid
 JOIN pg_catalog.pg_namespace tn ON tn.oid=tc.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[1]
 WHERE k.contype='f' AND cardinality(k.conkey)=1 AND cardinality(k.confkey)=1
 AND n.nspname IN ('titan','titan_config')`);
 return {relations:tables.rows.map(x=>x.relation),
  foreignKeys:keys.rows.map(x=>({table:x.table_name,column:x.column_name,target:x.target_name}))};
}
export async function verifyCanonicalSchema(client){
 const catalog=await inspectCanonicalSchema(client);
 assertCanonicalSchema(catalog);
 return catalog;
}
