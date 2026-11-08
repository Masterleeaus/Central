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
  }),/trusted Central|secure Central origin/);
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
