import {readConfigDbSettings} from './config-db-settings.mjs';
export function createConfigDbRuntime({env={},Pool}={}){
 const uris=readConfigDbSettings(env);
 if(!uris)return null;
 if(typeof Pool!=='function')throw Error('missing Postgres Pool');
 const configPool=new Pool({connectionString:uris.config,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:10000});
 let grantPool;
 try{grantPool=new Pool({connectionString:uris.grants,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:10000})}
 catch(error){void Promise.resolve().then(()=>configPool.end()).catch(()=>{});throw error}
 let closing;
 return Object.freeze({configPool,grantPool,close(){
  if(!closing)closing=(async()=>{
   const results=await Promise.allSettled([Promise.resolve().then(()=>configPool.end()),Promise.resolve().then(()=>grantPool.end())]);
   const errors=results.filter(x=>x.status==='rejected').map(x=>x.reason);
   if(errors.length)throw new AggregateError(errors,'configuration database pool close failed');
  })();
  return closing;
 }});
}
