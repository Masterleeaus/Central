import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDefinition} from '../src/definition-store.mjs';
const definition={key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false};
test('immutable definition inserted once',async()=>{
 let params;const item=await registerDefinition({definition,pool:{query:async(q,p)=>(params=p,{rowCount:1})}});
 assert.equal(item.key,'flag');assert.equal(params[4],'false');
 await assert.rejects(registerDefinition({definition,pool:{query:async()=>({rowCount:0})}}));
});
