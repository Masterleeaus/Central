import test from 'node:test';
import assert from 'node:assert/strict';
import { LogtoManagementVerifier } from '../dist/logto-management.js';
const token='trusted-service-credential';
const setup=(impl,maxPages)=>new LogtoManagementVerifier({origin:'https://identity.example.test',accessToken:async()=>token,fetcher:async(url,opts)=>{
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,`Bearer ${token}`);
  assert.match(url,/^https:\/\/identity\.example\.test\/api\//);
  return impl(new URL(url));
},maxPages});
const res=(value,ok=true)=>({ok,json:async()=>value});
function fixture(organisationMembers=['user_a']){return setup(url=>{
 if(url.pathname==='/api/users/user_a') return res({id:'user_a'});
 if(url.pathname==='/api/organizations/org_a') return res({id:'org_a'});
 if(url.pathname==='/api/organizations/org_a/users') return res(organisationMembers.map(id=>({id})));
 return res({},false);
});}
test('accepts direct verified membership',async()=>assert.doesNotReject(fixture().assertMembership('user_a','org_a')));
test('rejects missing membership',async()=>assert.rejects(fixture([]).assertMembership('user_a','org_a'),/not a current/));
test('rejects user mismatch',async()=>assert.rejects(fixture().assertMembership('user_b','org_a')));
test('rejects invalid input before network',async()=>assert.rejects(fixture().assertMembership('..%2Fadmin','org_a')));
test('rejects unsafe origin',()=>assert.throws(()=>new LogtoManagementVerifier({origin:'http://example.com',accessToken:async()=>token}),/HTTPS/));
test('fails on API error',async()=>assert.rejects(setup(()=>res({},false)).assertIdentity('user_a'),/rejected/));
test('fails closed on invalid response',async()=>assert.rejects(setup(()=>res([])).assertIdentity('user_a'),/not found/));
test('supports verified identity',async()=>assert.doesNotReject(fixture().assertIdentity('user_a')));
test('supports verified organisation',async()=>assert.doesNotReject(fixture().assertOrganisation('org_a')));
test('rejects credential with CRLF',async()=>assert.rejects(new LogtoManagementVerifier({origin:'https://identity.example.test',accessToken:async()=>token+'\r\n',fetcher:async()=>res({id:'user_a'})}).assertIdentity('user_a'),/credential/));
test('rejects truncated pagination',async()=>{const v=setup(url=>url.pathname.endsWith('/users')?res(Array.from({length:100},(_,i)=>({id:`user_${i}`}))):res({id:url.pathname.endsWith('/user_a')?'user_a':'org_a'}),1);await assert.rejects(v.assertMembership('user_a','org_a'),/exceeded safe/);});
