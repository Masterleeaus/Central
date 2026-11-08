import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';
import {createCentralHandler} from '../src/app.mjs';
const ORG='00000000-0000-4000-8000-000000000001';
const principal={logtoSubject:'user1',issuer:'https://issuer.example',audience:'control',verifiedAt:new Date().toISOString()};
async function run(path,{auth=true,verify=async()=>principal,query=async()=>({rows:[]})}={}) {const calls=[];const pool={async connect(){return {async query(sql,args){calls.push([sql,args]);return query(sql,args)},release(){calls.push(['RELEASE'])}}}};const server=createServer(createCentralHandler({pool,verifyToken:verify,issuer:'https://issuer.example',audience:'control'}));server.listen(0,'127.0.0.1');await once(server,'listening');try {const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:auth?{authorization:'Bearer abc.def.ghi'}:{}});return {status:r.status,body:await r.json(),calls}}finally{server.close();await once(server,'close')}}
test('health is up without database',async()=>assert.equal((await run('/healthz',{auth:false})).status,200));
test('rejects requests without bearer',async()=>assert.equal((await run('/v1/access/check',{auth:false})).status,401));
test('rejects invalid bearer',async()=>assert.equal((await run('/v1/access/check',{verify:async()=>{throw Error('invalid')}})).status,401));
test('rejects caller-supplied identity',async()=>assert.equal((await run(`/v1/access/check?organisation_id=${ORG}&application=supercharged&action=read:jobs&user_id=someone`)).status,400));
test('rejects duplicated tenant params',async()=>assert.equal((await run(`/v1/access/check?organisation_id=${ORG}&organisation_id=${ORG}&application=supercharged&action=read:jobs`)).status,400));
test('rejects invalid organisation',async()=>assert.equal((await run('/v1/access/check?organisation_id=none&application=supercharged&action=read:jobs')).status,400));
test('denies unknown identity, releases client',async()=>{const r=await run(`/v1/access/check?organisation_id=${ORG}&application=supercharged&action=read:jobs`);assert.equal(r.status,403);assert.equal(r.calls.at(-1)[0],'RELEASE');assert.ok(r.calls.some(x=>x[0]==='COMMIT'))});
test('query failure returns 503 and rolls back',async()=>{const r=await run(`/v1/access/check?organisation_id=${ORG}&application=supercharged&action=read:jobs`,{query:async(sql)=>{if(sql.startsWith('SELECT'))throw Error('db offline');return {rows:[]}}});assert.equal(r.status,503);assert.ok(r.calls.some(x=>x[0]==='ROLLBACK'));});
