/** Closing is idempotent; failure of any one resource never skips another. */
export function createServiceLifecycle({server,pool,runtime}={}){
 if(!server||typeof server.close!=='function'||typeof pool?.end!=='function')throw Error('missing lifecycle resource');
 let closing;
 return Object.freeze({
  close(){
   if(closing)return closing;
   closing=(async()=>{
    const done=await Promise.allSettled([
     new Promise((resolve,reject)=>{try{server.close(error=>error?reject(error):resolve())}catch(error){reject(error)}}),
     Promise.resolve().then(()=>runtime?.close?.()),
     Promise.resolve().then(()=>pool.end())
    ]);
    const errors=done.filter(x=>x.status==='rejected').map(x=>x.reason);
    if(errors.length)throw new AggregateError(errors,'service shutdown failed');
   })();
   return closing;
  }
 });
}
