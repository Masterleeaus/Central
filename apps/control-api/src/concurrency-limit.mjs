/**
 * Bounded in-process concurrency guard for expensive authentication,
 * access and browser selection operations.
 *
 * Never trusts HTTP headers for the client key; callers supply socket-derived
 * addresses. It is a second line of defence, NOT a multi-instance or proxy
 * distributed limiter. A live key is never evicted to admit another key.
 */
export function createConcurrencyLimiter({perKey=4,globalLimit=96,maxKeys=4096}={}) {
  for(const [name,value] of Object.entries({perKey,globalLimit,maxKeys})) {
    if(!Number.isSafeInteger(value)||value<1||value>100_000)
      throw new TypeError('invalid concurrency '+name);
  }
  const active=new Map();
  let total=0;
  return Object.freeze({
    acquire(rawKey) {
      if(typeof rawKey!=='string'||rawKey.length<1||rawKey.length>256)
        return null;
      const n=active.get(rawKey)??0;
      if(total>=globalLimit||n>=perKey||(n===0&&active.size>=maxKeys))
        return null;
      active.set(rawKey,n+1);
      total++;
      let released=false;
      return ()=>{
        if(released)return;
        released=true;
        total--;
        const remaining=(active.get(rawKey)??1)-1;
        if(remaining===0)active.delete(rawKey);
        else active.set(rawKey,remaining);
      };
    },
    snapshot(){return Object.freeze({active:total,keys:active.size});}
  });
}
