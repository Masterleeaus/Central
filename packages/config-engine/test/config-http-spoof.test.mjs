import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigHttpReadHandler} from '../src/http-read.mjs';
test('company header spoof is rejected before token validation',async()=>{
 const h=createConfigHttpReadHandler({authenticate:async()=>{throw Error('must not run')},resolveCompany:async()=>{},store:{readSnapshot:async()=>{}},salt:'long-private-secret'});
 const res={writeHead(n){this.status=n},end(){}};
 await h({method:'GET',url:'/v1/config/evaluate?key=x&application=central&environment=stage',headers:{'x-company-id':'other'}},res);
 assert.equal(res.status,400);
});
