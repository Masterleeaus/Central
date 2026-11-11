import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigHttpReadHandler} from '../src/http-read.mjs';
const res=()=>({writeHead(s,h){this.status=s;this.headers=h},end(b){this.body=b}});
test('rejects explicit company override in client URL',async()=>{
 const handler=createConfigHttpReadHandler({authenticate:async()=>({kind:'service',authenticated:true,products:['central']}),
  resolveCompany:async()=>({product:'central',environment:'stage',companyId:'550e8400-e29b-41d4-a716-446655440000'}),
  store:{readSnapshot:async()=>({definition:{key:'flag',owner:'ops',product:'central',type:'boolean',defaultValue:false},overrides:[]})},salt:'long-private-secret'});
 const a=res();await handler({url:'/v1/config/evaluate?key=flag&application=central&environment=stage&company_id=foreign',method:'GET',headers:{}},a);
 assert.equal(a.status,400);
 const b=res();await handler({url:'/v1/config/evaluate?key=flag&application=central&environment=stage',method:'GET',headers:{}},b);
 assert.equal(b.status,200);
});
