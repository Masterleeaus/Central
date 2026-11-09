/** Every resource receives a close attempt even when earlier closures fail. */
export async function closeFailedStartup({pool,runtime}={}){
 const operations=[];
 if(runtime?.close)operations.push(Promise.resolve().then(()=>runtime.close()));
 if(pool?.end)operations.push(Promise.resolve().then(()=>pool.end()));
 return Promise.allSettled(operations);
}
