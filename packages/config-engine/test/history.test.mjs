import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryReader} from '../src/history.mjs';
test('read history scoped by product environment and cohort',async()=>{
 let params;const history=createHistoryReader({pool:{query:async(q,p)=>(params=p,{rows:[{revision:'2',action:'set',created_at:'date',correlation_id:'trace'}]})}});
 const actor={id:'ops',permissions:['config:read:central:staging']};
 assert.equal((await history({actor,key:'flag',product:'central',environment:'staging',target:{cohort:'beta'}}))[0].revision,2);
 assert.deepEqual(params.slice(0,5),['central','flag','staging','cohort','beta']);
 await assert.rejects(history({actor,key:'flag',product:'central',environment:'production'}));
});
