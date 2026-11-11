import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollback} from '../src/rollback.mjs';
test('rollback cannot target missing prior revision',async()=>{
 const service=createRollback({store:{
  getHistoricalOverride:async()=>null,getDefinition:async()=>null,commitOverride:async()=>{throw Error('unsafe commit');}
 }});
 const actor={id:'ops',permissions:['config:rollback:central:staging']};
 await assert.rejects(service({actor,key:'flag',product:'central',environment:'staging',toRevision:1,expectedRevision:2,reason:'revert bad launch'}));
});
