import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralHandler} from '../src/app.mjs';
const opts={pool:{query:async()=>({rows:[]})},verifyToken:async()=>{},issuer:'https://issuer.test',audiences:{field:'a',desk:'b',academy:'c'}};
const res=()=>({writeHead(s){this.status=s},end(){}});
test('config route is hidden unless injected',async()=>{
 const a=res();await createCentralHandler(opts)({url:'/v1/config/evaluate',method:'GET',headers:{}},a);assert.equal(a.status,404);
 const b=res();await createCentralHandler({...opts,configEvaluationHandler:async(req,r)=>{r.writeHead(204);r.end();return true}})({url:'/v1/config/evaluate',method:'GET',headers:{}},b);assert.equal(b.status,204);
});

test('legacy flag reads and engine evaluation use independent handlers',async()=>{
 const calls=[];
 const handler=createCentralHandler({...opts,
  configHandler:async(req,r)=>{calls.push('flags');r.writeHead(204);r.end();return true},
  configEvaluationHandler:async(req,r)=>{calls.push('engine');r.writeHead(202);r.end();return true}});
 const a=res();await handler({url:'/internal/v1/config/flags',method:'GET',headers:{}},a);
 const b=res();await handler({url:'/v1/config/evaluate',method:'GET',headers:{}},b);
 assert.deepEqual(calls,['flags','engine']);assert.equal(a.status,204);assert.equal(b.status,202);
});
