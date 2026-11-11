import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCentralHandler} from '../src/app.mjs';

// Pins the trust rule: the default per-IP key is the socket address. A client-sent
// X-Forwarded-For must not change which bucket a request is counted in.
const audiences={field:'aud-field',desk:'aud-desk',academy:'aud-academy'};
const pool={query:async()=>({rows:[]})};

async function withServer(handler, fn) {
  const server=createServer(handler);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const {port}=server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise(r=>server.close(r)); }
}

test('spoofed X-Forwarded-For does not move a client into a fresh per-IP bucket',async()=>{
  const handler=createCentralHandler({
    pool,verifyToken:async()=>{throw Error('unused')},issuer:'https://issuer.example/',audiences,
    rateLimits:{ip:{limit:2,windowMs:60_000},subject:{limit:300,windowMs:60_000}},
  });
  await withServer(handler, async base=>{
    const statuses=[];
    for (let i=0;i<3;i++) {
      const res=await fetch(`${base}/v1/access/check`,{headers:{'x-forwarded-for':`203.0.113.${i+1}`}});
      statuses.push(res.status);
      await res.arrayBuffer();
    }
    // Two requests are allowed (401 unauthenticated, no token); the third is rate limited by socket address.
    assert.deepEqual(statuses,[401,401,429]);
  });
});
