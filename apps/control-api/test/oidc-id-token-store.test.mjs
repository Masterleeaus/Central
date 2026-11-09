// Issue #6 (a)(b): encrypted ID-token vault and logout session authenticator. No network, no database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdTokenVault,createLogoutSessionAuthenticator,deriveIdTokenKey} from '../src/oidc-id-token-store.mjs';
import {createStateSealer} from '../src/oidc-state-crypto.mjs';

const KEY=Buffer.alloc(32,7).toString('base64');
const ENV={TITAN_OIDC_STATE_KEY:KEY};
const TOKEN='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzdWIxIn0.c2ln';
const SID='session_abc-12345';
const SUB='logto_user_1';
const vault=(applicationId='desk',env=ENV)=>createIdTokenVault({applicationId,env});

test('seal then open returns the exact token for the same app, session and subject',()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  assert.equal(v.open({sealed,sessionId:SID,subject:SUB}),TOKEN);
});
test('the sealed value is opaque: it does not contain the token or its claims',()=>{
  const sealed=vault().seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  assert.ok(sealed.startsWith('v1.'));
  assert.equal(sealed.includes(TOKEN),false);assert.equal(sealed.includes('eyJzdWIi'),false);
});
test('each seal uses a fresh nonce, so equal inputs give different ciphertexts',()=>{
  const v=vault();assert.notEqual(v.seal({idToken:TOKEN,sessionId:SID,subject:SUB}),v.seal({idToken:TOKEN,sessionId:SID,subject:SUB}));
});
test('AAD: a sealed token opens only for its own session id',()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  assert.throws(()=>v.open({sealed,sessionId:'session_other-999',subject:SUB}),/rejected/);
});
test('AAD: a sealed token opens only for its own subject',()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  assert.throws(()=>v.open({sealed,sessionId:SID,subject:'logto_user_2'}),/rejected/);
});
test('AAD: a sealed token from one application does not open in another application',()=>{
  const sealed=vault('desk').seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  assert.throws(()=>vault('field').open({sealed,sessionId:SID,subject:SUB}),/rejected/);
  assert.throws(()=>vault('academy').open({sealed,sessionId:SID,subject:SUB}),/rejected/);
});
test('a different state key cannot open the value',()=>{
  const sealed=vault().seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  const other=createIdTokenVault({applicationId:'desk',env:{TITAN_OIDC_STATE_KEY:Buffer.alloc(32,9).toString('base64')}});
  assert.throws(()=>other.open({sealed,sessionId:SID,subject:SUB}),/rejected/);
});
test('tampered ciphertext, truncation and wrong prefix are rejected',()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  const flipped=sealed.slice(0,-3)+(sealed.at(-3)==='A'?'B':'A')+sealed.slice(-2);
  assert.throws(()=>v.open({sealed:flipped,sessionId:SID,subject:SUB}),/rejected/);
  assert.throws(()=>v.open({sealed:sealed.slice(0,30),sessionId:SID,subject:SUB}),/rejected/);
  assert.throws(()=>v.open({sealed:'v2.'+sealed.slice(3),sessionId:SID,subject:SUB}),/rejected/);
  assert.throws(()=>v.open({sealed:undefined,sessionId:SID,subject:SUB}),/rejected/);
  assert.throws(()=>v.open({sealed:'',sessionId:SID,subject:SUB}),/rejected/);
});
test('the ID-token subkey is separate from the raw state key',()=>{
  const sealed=vault().seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  const rawKey=Buffer.from(KEY,'base64');
  const stateSealer=createStateSealer({key:rawKey});
  assert.throws(()=>stateSealer.open(sealed,`titan_oidc_id_token|desk|${SID}|${SUB}`),/rejected/);
  assert.equal(deriveIdTokenKey(rawKey).equals(rawKey),false);
  assert.equal(deriveIdTokenKey(rawKey).length,32);
});
test('fails closed when TITAN_OIDC_STATE_KEY is missing',()=>{
  assert.throws(()=>createIdTokenVault({applicationId:'desk',env:{}}),/TITAN_OIDC_STATE_KEY must be set/);
  assert.throws(()=>createIdTokenVault({applicationId:'desk'}),/must be set/);
});
test('fails closed on a malformed key: wrong length, not base64, or empty',()=>{
  for(const bad of ['',Buffer.alloc(16).toString('base64'),Buffer.alloc(33).toString('base64'),'not base64 at all!!','A'.repeat(43)]){
    assert.throws(()=>createIdTokenVault({applicationId:'desk',env:{TITAN_OIDC_STATE_KEY:bad}}),TypeError,bad);
  }
});
test('refuses an unknown application',()=>{
  assert.throws(()=>createIdTokenVault({applicationId:'admin',env:ENV}),TypeError);
  assert.throws(()=>createIdTokenVault({applicationId:undefined,env:ENV}),TypeError);
});
test('refuses bindings and tokens that do not fit the expected shape',()=>{
  const v=vault();
  for(const sid of ['short','has space in it x','x'.repeat(257),'session:colon-ok-but-not-allowed'])
    assert.throws(()=>v.seal({idToken:TOKEN,sessionId:sid,subject:SUB}),TypeError,sid);
  for(const sub of ['','bad subject','x'.repeat(201)])
    assert.throws(()=>v.seal({idToken:TOKEN,sessionId:SID,subject:sub}),TypeError,sub);
  for(const t of ['not-a-jwt','a.b','a.b.c.d',TOKEN+'\r\nSet-Cookie: x=1','x'.repeat(16385),'',undefined])
    assert.throws(()=>v.seal({idToken:t,sessionId:SID,subject:SUB}),TypeError);
});
test('open refuses an oversized or malformed value even with a valid tag',()=>{
  const v=vault();
  assert.throws(()=>v.open({sealed:v.seal({idToken:TOKEN,sessionId:SID,subject:SUB}),sessionId:'bad id',subject:SUB}),TypeError);
});
test('the vault is frozen so callers cannot swap its behaviour',()=>{
  const v=vault();assert.equal(Object.isFrozen(v),true);
});

// Logout session authenticator
const scope=(org='org-a',sub=SUB)=>({logtoSubject:sub,organisationId:org});
const goodSession=(sealed,extra={})=>({sessionId:SID,logtoSubject:SUB,scopes:[scope()],sealedIdToken:sealed,...extra});
const authFor=(loadSession,v=vault())=>createLogoutSessionAuthenticator({applicationId:'desk',vault:v,loadSession});
test('authenticator returns the opened ID token as idTokenHint and the caller scopes',async()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  const out=await authFor(async()=>goodSession(sealed),v)({});
  assert.deepEqual(out,{idTokenHint:TOKEN,scopes:[{logtoSubject:SUB,organisationId:'org-a'}]});
});
test('authenticator returns only the scope fields, never extra session data',async()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  const out=await authFor(async()=>goodSession(sealed,{scopes:[{...scope(),userId:'u',email:'x@y'}]}),v)({});
  assert.deepEqual(Object.keys(out.scopes[0]).sort(),['logtoSubject','organisationId']);
});
test('no session resolves to null, so the route answers 401',async()=>{
  assert.equal(await authFor(async()=>null)({}),null);
});
test('a lookup error resolves to null, never to a partial session',async()=>{
  assert.equal(await authFor(async()=>{throw Error('db down')})({}),null);
});
test('a session with a foreign-subject scope is refused (no cross-user revocation)',async()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  assert.equal(await authFor(async()=>goodSession(sealed,{scopes:[scope('org-a'),scope('org-b','someone_else')]}),v)({}),null);
});
test('empty scopes, malformed scopes and non-string organisation ids are refused',async()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:SID,subject:SUB});
  for(const scopes of [[],[{logtoSubject:SUB}],[{logtoSubject:SUB,organisationId:'org a'}],[null]])
    assert.equal(await authFor(async()=>goodSession(sealed,{scopes}),v)({}),null);
});
test('a sealed token bound to another session id is refused',async()=>{
  const v=vault();const sealed=v.seal({idToken:TOKEN,sessionId:'session_other-999',subject:SUB});
  assert.equal(await authFor(async()=>goodSession(sealed),v)({}),null);
});
test('a missing or tampered sealed token is refused',async()=>{
  const v=vault();
  assert.equal(await authFor(async()=>goodSession(undefined),v)({}),null);
  assert.equal(await authFor(async()=>goodSession('v1.AAAA'),v)({}),null);
});
test('construction refuses an unknown app, a missing vault or a missing loader',()=>{
  assert.throws(()=>createLogoutSessionAuthenticator({applicationId:'admin',vault:vault(),loadSession:async()=>null}),TypeError);
  assert.throws(()=>createLogoutSessionAuthenticator({applicationId:'desk',vault:null,loadSession:async()=>null}),TypeError);
  assert.throws(()=>createLogoutSessionAuthenticator({applicationId:'desk',vault:vault()}),TypeError);
});
