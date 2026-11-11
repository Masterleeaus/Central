import {fail} from './errors.mjs';
export function assertSnapshot(snapshot){
 if(!snapshot||!snapshot.definition||!Array.isArray(snapshot.overrides)||
    snapshot.overrides.length>10000)fail('invalid_snapshot');
 return snapshot;
}
