import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigHttpReadHandler} from '../src/http-read.mjs';
test('rejects extra query parameters before authentication',async()=>{
 const handler=createConfigHttpReadHandler({authenticate:async()=>{throw Error('unexpected')},resolveCompany:async()=>{},store:{readSnapshot:async()=>{}},salt:'long-private-salt'});
 const res={writeHead(code){this.code=code},end(){}};
 await handler({method:'GET',url:'/v1/config/evaluate?key=flag&application=central&environment=staging&company_id=other',headers:{}},res);
 assert.equal(res.code,400);
});
