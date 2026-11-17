/** Periodic cleanup for expired OIDC login-state rows (issue #11).
 * pruneExpired only deletes rows once something calls it. This starts a timer that calls it on a fixed
 * interval, under the restricted writer role that pruneExpired already uses. The timer is unref'd so it
 * never keeps the process alive, a run that is still going is not started again, and a failed run is
 * reported and retried on the next tick. */
import {pruneExpired} from './oidc-state-pg.mjs';
const MIN_INTERVAL_MS=60_000;
const MAX_INTERVAL_MS=3_600_000;
export const DEFAULT_OIDC_STATE_PRUNE_INTERVAL_MS=300_000;
export function startOidcStatePruning({pool,intervalMs=DEFAULT_OIDC_STATE_PRUNE_INTERVAL_MS,clock,onError=()=>{},onPruned=()=>{},prune=pruneExpired,schedule={setInterval,clearInterval}}={}) {
  if(typeof pool?.connect!=='function' || !Number.isSafeInteger(intervalMs) || intervalMs<MIN_INTERVAL_MS || intervalMs>MAX_INTERVAL_MS || typeof prune!=='function' || typeof schedule?.setInterval!=='function' || typeof schedule?.clearInterval!=='function')throw new TypeError('invalid OIDC state prune schedule');
  let running=false;
  let stopped=false;
  const tick=async()=>{
    if(running||stopped)return;
    running=true;
    try{
      const removed=await prune(pool,clock);
      onPruned(removed);
    }catch(error){
      try{onError(error);}catch{/* a reporting failure never stops the schedule */}
    }finally{
      running=false;
    }
  };
  const timer=schedule.setInterval(()=>tick(),intervalMs);
  timer?.unref?.();
  return Object.freeze({
    stop(){
      if(stopped)return;
      stopped=true;
      schedule.clearInterval(timer);
    },
    tick
  });
}
