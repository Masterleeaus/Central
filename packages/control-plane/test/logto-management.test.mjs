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
 // Upstream GET /api/users/{userId}/organizations: unpaginated list of the user's organisations.
 if(url.pathname==='/api/users/user_a/organizations') return res(organisationMembers.length?[{id:'org_a',name:'Acme'}]:[]);
 if(url.pathname==='/api/users/user_a') return res({id:'user_a'});
 if(url.pathname==='/api/organizations/org_a') return res({id:'org_a'});
 return res({},false);
});}
test('accepts direct verified membership',async()=>assert.doesNotReject(fixture().assertMembership('user_a','org_a')));
test('rejects missing membership',async()=>assert.rejects(fixture([]).assertMembership('user_a','org_a'),/not a current/));
test('rejects user mismatch',async()=>assert.rejects(fixture().assertMembership('user_b','org_a')));
test('rejects a 404 user without granting membership',async()=>assert.rejects(setup(()=>res({},false)).assertMembership('user_a','org_a'),/rejected/));
test('finds the organisation among several returned organisations',async()=>{const v=setup(url=>url.pathname==='/api/users/user_a/organizations'?res([{id:'org_x'},{id:'org_y'},{id:'org_a'}]):res({},false));await assert.doesNotReject(v.assertMembership('user_a','org_a'));});
test('sends exactly one unpaginated request per membership check',async()=>{const seen=[];const v=setup(url=>{seen.push(url.pathname+url.search);return url.pathname==='/api/users/user_a/organizations'?res([{id:'org_a'}]):res({},false);});await v.assertMembership('user_a','org_a');assert.deepEqual(seen,['/api/users/user_a/organizations']);});
test('rejects invalid input before network',async()=>assert.rejects(fixture().assertMembership('..%2Fadmin','org_a')));
test('rejects unsafe origin',()=>assert.throws(()=>new LogtoManagementVerifier({origin:'http://example.com',accessToken:async()=>token}),/HTTPS/));
test('fails on API error',async()=>assert.rejects(setup(()=>res({},false)).assertIdentity('user_a'),/rejected/));
test('fails closed on invalid response',async()=>assert.rejects(setup(()=>res([])).assertIdentity('user_a'),/not found/));
test('supports verified identity',async()=>assert.doesNotReject(fixture().assertIdentity('user_a')));
test('supports verified organisation',async()=>assert.doesNotReject(fixture().assertOrganisation('org_a')));
test('rejects credential with CRLF',async()=>assert.rejects(new LogtoManagementVerifier({origin:'https://identity.example.test',accessToken:async()=>token+'\r\n',fetcher:async()=>res({id:'user_a'})}).assertIdentity('user_a'),/credential/));
test('rejects oversized user organisation response (fail closed)',async()=>{const v=setup(url=>url.pathname==='/api/users/user_a/organizations'?res(Array.from({length:1001},(_,i)=>({id:`org_${i}`}))):res({},false));await assert.rejects(v.assertMembership('user_a','org_a'),/invalid user organisation/);});
