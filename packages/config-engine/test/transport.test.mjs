import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigReadTransport} from '../src/transport.mjs';
const store={readSnapshot:async()=>({definition:{key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false},overrides:[]})};
test('trusted service must own app and company context',async()=>{
 const read=createConfigReadTransport({authenticate:async()=>({kind:'service',authenticated:true,products:['central']}),
  resolveCompany:async()=>({product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000'}),store,salt:'long-private-secret'});
 assert.equal((await read({key:'flag',application:'central',environment:'stage'})).value,false);
 await assert.rejects(read({key:'flag',application:'sorted',environment:'stage'}));
});
