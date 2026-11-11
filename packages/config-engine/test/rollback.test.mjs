import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollback} from '../src/rollback.mjs';
const actor={id:'ops',permissions:['config:rollback:central:staging']};
test('rollback writes new immutable revision',async()=>{
 let change;
 const store={getHistoricalOverride:async()=>({product:'central',environment:'staging',target:{},value:false,percentage:100,expiresAt:null,revision:1}),
 getDefinition:async()=>({key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false}),
 commitOverride:async value=>(change=value,value.override.revision)};
 const rollback=createRollback({store});
 assert.equal(await rollback({actor,key:'flag',product:'central',environment:'staging',toRevision:1,expectedRevision:3,reason:'restore previous state'}),4);
 assert.equal(change.audit.action,'config_override_rolled_back');
 await assert.rejects(rollback({actor,key:'flag',product:'central',environment:'production',toRevision:1,expectedRevision:3,reason:'restore previous state'}));
});
