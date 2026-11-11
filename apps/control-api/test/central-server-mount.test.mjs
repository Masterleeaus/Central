import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {startCentralService} from '../src/server.mjs';
const env={
  TITAN_CENTRAL_DATABASE_URL:'postgresql://unit-test.example/central',
  TITAN_OIDC_ISSUER:'https://issuer.example',
  TITAN_OIDC_JWKS_URI:'https://issuer.example/jwks',
  TITAN_FIELD_AUDIENCE:'field-aud',TITAN_DESK_AUDIENCE:'desk-aud',
  TITAN_ACADEMY_AUDIENCE:'academy-aud'
};
async function availablePort(){
  const server=createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
function fakeDatabase(){
  const stats={ended:0};
  class Pool{
    async connect(){return {async query(){return {rows:[]}},release(){}}}
    async end(){stats.ended++}
  }
  return {stats,loadPg:async()=>({Pool})};
}
test('actual HTTP server delegates the browser login path to an explicitly configured handler',async()=>{
  const db=fakeDatabase();let created=0,handled=0;
  const port=await availablePort();
  const service=await startCentralService({
    env:{...env,TITAN_CENTRAL_PORT:String(port)},
    loadPg:db.loadPg,verifyToken:async()=>({}),
    createBrowserRouter:()=>{created++;return {async handler(req,res){
      if(req.url!=='/auth/central/start')return false;
      handled++;res.writeHead(200,{'content-type':'text/plain'});res.end('browser router mounted');return true;
    }}}
  });
  try{
    const result=await fetch('http://127.0.0.1:'+port+'/auth/central/start');
    assert.equal(result.status,200);
    assert.equal(await result.text(),'browser router mounted');
    assert.equal(created,1);assert.equal(handled,1);
  }finally{await service.close()}
  assert.equal(db.stats.ended,1);
});
test('invalid browser startup configuration fails before listening and closes pool',async()=>{
  const db=fakeDatabase();
  await assert.rejects(startCentralService({
    env:{...env,TITAN_CENTRAL_BROWSER_ENABLED:'1'},
    loadPg:db.loadPg,verifyToken:async()=>({}),
  }),/trusted Central|secure Central origin|PostgreSQL/);
  assert.equal(db.stats.ended,1);
});
test('disabled browser configuration does not require company-name resolver',async()=>{
  const db=fakeDatabase();
  const port=await availablePort();
  const service=await startCentralService({
    env:{...env,TITAN_CENTRAL_BROWSER_ENABLED:'0',TITAN_CENTRAL_PORT:String(port)},
    loadPg:db.loadPg,verifyToken:async()=>({})
  });
  try{
    assert.ok(service.server.listening);
    assert.equal(db.stats.ended,0);
  }finally{await service.close()}
  assert.equal(db.stats.ended,1);
});

test('enabled browser builds an independent canonical name pool and closes both on shutdown',async()=>{
  const constructed=[],ended=[];
  class Pool{
    constructor(opts){constructed.push(opts.connectionString)}
    async connect(){return {async query(sql){
      if(sql.includes("to_regclass('titan.companies')"))return {rows:[{
        companies:'titan.companies',links:'titan.central_legacy_company_links',
        resolver:'titan.resolve_verified_central_company(uuid,text)'
      }]};
      return {rows:[]};
    },release(){}}}
    async end(){ended.push(true)}
  }
  const port=await availablePort();
  let receivedNameProvider=false;
  const service=await startCentralService({
    env:{...env,TITAN_CENTRAL_PORT:String(port),TITAN_CENTRAL_BROWSER_ENABLED:'1',
      TITAN_CENTRAL_SHARED_DATABASE_URL:'postgresql://unit-test.example/titan_shared'},
    loadPg:async()=>({Pool}),verifyToken:async()=>({}),
    createBrowserRouter:({getCompanyName})=>{
      receivedNameProvider=typeof getCompanyName==='function';
      return {handler:async()=>false};
    }
  });
  try{
    assert.deepEqual(constructed,[env.TITAN_CENTRAL_DATABASE_URL,
      'postgresql://unit-test.example/titan_shared']);
    assert.equal(receivedNameProvider,true);
  }finally{await service.close()}
  assert.equal(ended.length,2);
});

test('server enforces finite connection and HTTP header/request deadlines',async()=>{
 const db=fakeDatabase();const port=await availablePort();
 const service=await startCentralService({
  env:{...env,TITAN_CENTRAL_PORT:String(port)},
  loadPg:db.loadPg,verifyToken:async()=>({})
 });
 try {
  assert.equal(service.server.maxConnections,128);
  assert.equal(service.server.headersTimeout,10000);
  assert.equal(service.server.requestTimeout,15000);
  assert.equal(service.server.keepAliveTimeout,5000);
 }finally{await service.close()}
});