import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigReadTransport} from '../src/transport.mjs';
test('denied service grant prevents SQL evaluation',async()=>{
 let db=0;const reader=createConfigReadTransport({authenticate:async()=>({kind:'service',authenticated:true,clientId:'svc'}),
 resolveCompany:async()=>{throw Error('no grant')},store:{readSnapshot:async()=>{db++;return{}}},salt:'long-private-secret'});
 await assert.rejects(reader({key:'flag',application:'central',environment:'stage'}));
 assert.equal(db,0);
});
