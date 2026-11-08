import {test} from 'node:test';import assert from 'node:assert/strict';
import {createAdminHandler} from '../src/admin.mjs';
test('malformed admin URL gets 400 and does not throw',async()=>{
 const handler=createAdminHandler({verifyToken:async()=>({logtoSubject:'op'}),authoriseOperator:async()=>true,origins:{desk:'https://desk.example',field:'https://field.example',academy:'https://academy.example'}});
 const res={code:0,writeHead(c){this.code=c},end(){}};
 assert.equal(await handler({url:'http://[::1',method:'GET',headers:{authorization:'Bearer a.b.c'}},res),true);
 assert.equal(res.code,400);
});
