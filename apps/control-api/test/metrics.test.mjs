import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {createMetrics, timedFetch, serveMetrics} from '../src/metrics.mjs';
import {startCentralService} from '../src/server.mjs';

const ORG='7d4f2c1a-9b3e-4f60-8a11-2c5e9d0b7a33';
const SUBJECT='op_subject_sentinel_metrics_31';

function fakeRes(){
 return {statusCode:undefined,headers:{},body:'',writeHead(status,headers){this.statusCode=status;this.headers=headers;},end(text){this.body=text??'';}};
}
const metricLine=(text,prefix)=>text.split('\n').find(l=>l.startsWith(prefix));

test('fresh metrics render every family with zero values and no label values', ()=>{
 const text=createMetrics().render();
 assert.match(text,/^# HELP titan_access_decisions_total /m);
 assert.match(text,/^# TYPE titan_logto_request_duration_seconds histogram$/m);
 assert.equal(metricLine(text,'titan_access_decisions_total{decision="allow"}'),'titan_access_decisions_total{decision="allow"} 0');
 assert.equal(metricLine(text,'titan_logto_requests_total{result="error"}'),'titan_logto_requests_total{result="error"} 0');
 assert.equal(metricLine(text,'titan_logto_request_duration_seconds_bucket{le="+Inf"}'),'titan_logto_request_duration_seconds_bucket{le="+Inf"} 0');
});

test('access decisions count allow and deny by reason, and unrecognised reasons collapse to other', ()=>{
 const m=createMetrics();
 m.observeLog('access_decision',{decision:'allow',application:'desk',organisation_id:ORG});
 m.observeLog('access_decision',{decision:'allow'});
 m.observeLog('access_decision',{decision:'deny',reason:'identity_inactive',organisation_id:ORG});
 m.observeLog('access_decision',{decision:'deny',reason:`${ORG} ${SUBJECT}`});
 m.observeLog('access_decision',{decision:'deny'});
 const text=m.render();
 assert.equal(metricLine(text,'titan_access_decisions_total{decision="allow"}'),'titan_access_decisions_total{decision="allow"} 2');
 assert.equal(metricLine(text,'titan_access_decisions_total{decision="deny",reason="identity_inactive"}'),'titan_access_decisions_total{decision="deny",reason="identity_inactive"} 1');
 assert.equal(metricLine(text,'titan_access_decisions_total{decision="deny",reason="other"}'),'titan_access_decisions_total{decision="deny",reason="other"} 2');
 assert.ok(!text.includes(ORG)&&!text.includes(SUBJECT));
});

test('rate-limit scopes, unauthenticated, errors and admin failures are counted; unknown events are ignored', ()=>{
 const m=createMetrics();
 m.observeLog('access_rate_limited',{scope:'ip'});
 m.observeLog('access_rate_limited',{scope:'subject'});
 m.observeLog('access_rate_limited',{scope:'elsewhere'});
 m.observeLog('access_unauthenticated');
 m.observeLog('access_error',{error_class:'Error'});
 m.observeLog('admin_provision_failed',new Error('x'));
 m.observeLog('something_else',{decision:'allow'});
 const text=m.render();
 assert.equal(metricLine(text,'titan_rate_limited_total{scope="ip"}'),'titan_rate_limited_total{scope="ip"} 1');
 assert.equal(metricLine(text,'titan_rate_limited_total{scope="subject"}'),'titan_rate_limited_total{scope="subject"} 1');
 assert.equal(metricLine(text,'titan_access_unauthenticated_total'),'titan_access_unauthenticated_total 1');
 assert.equal(metricLine(text,'titan_access_errors_total'),'titan_access_errors_total 1');
 assert.equal(metricLine(text,'titan_admin_provision_failed_total'),'titan_admin_provision_failed_total 1');
 assert.equal(metricLine(text,'titan_access_decisions_total{decision="allow"}'),'titan_access_decisions_total{decision="allow"} 0');
});

test('only 5xx responses count as server errors', ()=>{
 const m=createMetrics();
 for(const s of [200,403,404,429,500,503]) m.observeResponse(s);
 assert.equal(metricLine(m.render(),'titan_http_responses_5xx_total'),'titan_http_responses_5xx_total 2');
});

test('Logto latency is recorded in cumulative buckets with outcome counts', ()=>{
 const m=createMetrics();
 m.observeLogto(true,200);   // 0.2 s
 m.observeLogto(false,3000); // 3 s
 const text=m.render();
 assert.equal(metricLine(text,'titan_logto_requests_total{result="ok"}'),'titan_logto_requests_total{result="ok"} 1');
 assert.equal(metricLine(text,'titan_logto_requests_total{result="error"}'),'titan_logto_requests_total{result="error"} 1');
 assert.equal(metricLine(text,'titan_logto_request_duration_seconds_bucket{le="0.1"}'),'titan_logto_request_duration_seconds_bucket{le="0.1"} 0');
 assert.equal(metricLine(text,'titan_logto_request_duration_seconds_bucket{le="0.25"}'),'titan_logto_request_duration_seconds_bucket{le="0.25"} 1');
 assert.equal(metricLine(text,'titan_logto_request_duration_seconds_bucket{le="5"}'),'titan_logto_request_duration_seconds_bucket{le="5"} 2');
 assert.equal(metricLine(text,'titan_logto_request_duration_seconds_count'),'titan_logto_request_duration_seconds_count 2');
 assert.match(metricLine(text,'titan_logto_request_duration_seconds_sum'),/ 3\.2/);
});

test('timedFetch counts ok, non-ok and thrown calls, rethrows, and never records the URL', async()=>{
 const m=createMetrics();
 const url=`https://logto.example.test/api/organizations/${ORG}/users/${SUBJECT}/roles`;
 const okFetch=timedFetch(async()=>({ok:true}),m);
 const badFetch=timedFetch(async()=>({ok:false}),m);
 const throwFetch=timedFetch(async()=>{throw new Error('socket hang up');},m);
 await okFetch(url,{});
 await badFetch(url,{});
 await assert.rejects(throwFetch(url,{}),/socket hang up/);
 const text=m.render();
 assert.equal(metricLine(text,'titan_logto_requests_total{result="ok"}'),'titan_logto_requests_total{result="ok"} 1');
 assert.equal(metricLine(text,'titan_logto_requests_total{result="error"}'),'titan_logto_requests_total{result="error"} 2');
 assert.ok(!text.includes(ORG)&&!text.includes(SUBJECT));
});

test('serveMetrics answers loopback sockets only', ()=>{
 const m=createMetrics();
 const remote={url:'/metrics',socket:{remoteAddress:'10.0.0.5'}};
 const remoteRes=fakeRes();serveMetrics(remote,remoteRes,m);
 assert.equal(remoteRes.statusCode,404);
 assert.deepEqual(JSON.parse(remoteRes.body),{error:'not_found'});
 const local={url:'/metrics',socket:{remoteAddress:'127.0.0.1'}};
 const localRes=fakeRes();serveMetrics(local,localRes,m);
 assert.equal(localRes.statusCode,200);
 assert.match(localRes.headers['content-type'],/^text\/plain/);
});

test('GET /metrics on the running service exposes counters with no tenant or subject values', async()=>{
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 class FakePool{async query(){return {rows:[]};} async connect(){return {query:async()=>({rows:[]}),release(){}};} async end(){}}
 const verifyToken=async token=>{if(token==='good-token')return {logtoSubject:SUBJECT};throw new Error('bad');};
 const env={TITAN_CENTRAL_DATABASE_URL:'postgres://unused',TITAN_OIDC_ISSUER:'https://issuer.example.test',TITAN_OIDC_JWKS_URI:'https://issuer.example.test/jwks',TITAN_FIELD_AUDIENCE:'aud-field',TITAN_DESK_AUDIENCE:'aud-desk',TITAN_ACADEMY_AUDIENCE:'aud-academy',TITAN_CENTRAL_PORT:String(port)};
 const service=await startCentralService({env,loadPg:async()=>({Pool:FakePool}),verifyToken,logger:()=>{}});
 try{
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/v1/access/check`,{headers:{authorization:'Bearer bad-token'}})).status,401);
  const allowedCheck=await fetch(`${base}/v1/access/check?organisation_id=${ORG}&application=desk&action=read:jobs`,{headers:{authorization:'Bearer good-token'}});
  assert.equal(allowedCheck.status,403);
  const r=await fetch(`${base}/metrics`);
  const text=await r.text();
  assert.equal(r.status,200);
  assert.equal(metricLine(text,'titan_access_unauthenticated_total'),'titan_access_unauthenticated_total 1');
  assert.match(text,/titan_access_decisions_total\{decision="deny",reason="[a-z_]+"\} 1/);
  assert.ok(!text.includes(ORG),'organisation ID must not appear in metrics');
  assert.ok(!text.includes(SUBJECT),'subject must not appear in metrics');
 }finally{await service.close();}
});
