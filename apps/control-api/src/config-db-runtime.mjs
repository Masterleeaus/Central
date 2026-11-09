import {readConfigDbSettings} from './config-db-settings.mjs';
export function createConfigDbRuntime({env={},Pool}={}){
 const uris=readConfigDbSettings(env);
 if(!uris)return null;
 if(typeof Pool!=='function')throw Error('missing Postgres Pool');
 const configPool=new Pool({connectionString:uris.config,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
 const grantPool=new Pool({connectionString:uris.grants,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
 return Object.freeze({configPool,grantPool,async close(){await Promise.allSettled([configPool.end(),grantPool.end()])}});
}
