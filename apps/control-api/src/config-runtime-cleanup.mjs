export async function closeFailedStartup({pool,runtime}={}){
 const cleanup=[];
 if(runtime?.close)cleanup.push(Promise.resolve().then(()=>runtime.close()));
 if(pool?.end)cleanup.push(Promise.resolve().then(()=>pool.end()));
 return Promise.allSettled(cleanup);
}
