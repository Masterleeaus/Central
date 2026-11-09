import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigHttpReadHandler} from '../src/http-read.mjs';
test('browser cookies cannot authorise M2M configuration reads',async()=>{
 let auth=0;
 const h=createConfigHttpReadHandler({authenticate:async()=>{auth++;throw Error('should never verify browser session')},resolveCompany:async()=>{},store:{readSnapshot:async()=>{}},salt:'long-private-secret'});
 const res={writeHead(n){this.status=n},end(){}};
 await h({method:'GET',url:'/v1/config/evaluate?key=x&application=central&environment=stage',headers:{cookie:'session=x'}},res);
 assert.equal(res.status,400);assert.equal(auth,0);
});
