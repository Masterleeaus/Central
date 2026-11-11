import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindingCookiePolicy,appSessionCookiePolicy,buildPolicyCookie,buildClearCookie,isPolicySetCookie} from '../src/oidc-cookie-policy.mjs';
const SESSION=appSessionCookiePolicy('desk');
const BINDING=bindingCookiePolicy('desk');
const tok=(n)=>'a'.repeat(n);
const good=`desk_sid=${tok(43)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600`;

test('builds exact host-only cookie strings from the policy',()=>{
  assert.equal(buildPolicyCookie(SESSION,tok(43),3600),good);
  assert.equal(buildPolicyCookie(BINDING,tok(43),600),`titan_desk_oidc_binding=${tok(43)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`);
  assert.equal(buildClearCookie(SESSION),'desk_sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
});
test('every cookie the policy builds passes its own validator',()=>{
  assert.equal(isPolicySetCookie(SESSION,good),true);
  assert.equal(isPolicySetCookie(SESSION,buildClearCookie(SESSION)),true);
  assert.equal(isPolicySetCookie(BINDING,buildPolicyCookie(BINDING,tok(43),600)),true);
});
test('policy builder refuses values with CR/LF, separators or bad length',()=>{
  for(const v of [`${tok(43)}\r\nSet-Cookie: evil=1`,`${tok(43)};Domain=.titanzero.io`,`${tok(43)} x`,'short',tok(300)])
    assert.throws(()=>buildPolicyCookie(SESSION,v,3600),TypeError);
});
test('policy builder refuses out-of-range Max-Age and non-integers',()=>{
  for(const age of [0,59,86401,-1,NaN,'3600',3600.5]) assert.throws(()=>buildPolicyCookie(SESSION,tok(43),age),TypeError);
  assert.throws(()=>buildPolicyCookie(BINDING,tok(43),601),TypeError);
});
test('policy refuses unknown applications and unknown cookie names',()=>{
  assert.throws(()=>appSessionCookiePolicy('admin'),TypeError);
  assert.throws(()=>bindingCookiePolicy(undefined),TypeError);
});
test('rejects Domain attribute, including the leading-dot form',()=>{
  assert.equal(isPolicySetCookie(SESSION,`${good}; Domain=.titanzero.io`),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('Path=/;','Domain=titanzero.io; Path=/;')),false);
});
test('rejects SameSite=None and other unlisted SameSite values',()=>{
  assert.equal(isPolicySetCookie(SESSION,good.replace('SameSite=Lax','SameSite=None')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('SameSite=Lax','SameSite=none')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('SameSite=Lax','SameSite')),false);
});
test('accepts SameSite=Strict, the other permitted value',()=>{
  assert.equal(isPolicySetCookie(SESSION,good.replace('SameSite=Lax','SameSite=Strict')),true);
});
test('rejects duplicate attributes, including case-variant duplicates',()=>{
  assert.equal(isPolicySetCookie(SESSION,`${good}; Path=/`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}; Secure`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}; secure`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}; Max-Age=60`),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('HttpOnly','httponly; HttpOnly')),false);
});
test('rejects unknown and unlisted attributes',()=>{
  assert.equal(isPolicySetCookie(SESSION,`${good}; Partitioned`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}; Expires=Wed, 21 Oct 2037 07:28:00 GMT`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}; Foo=bar`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}; Priority=High`),false);
});
test('rejects a missing required attribute',()=>{
  for(const attr of ['Path=/','Secure','HttpOnly','SameSite=Lax','Max-Age=3600'])
    assert.equal(isPolicySetCookie(SESSION,good.replace(new RegExp(`(; )?${attr.replace(/[=/]/g,'\\$&')}`),'')),false,attr);
});
test('rejects a path other than /',()=>{
  assert.equal(isPolicySetCookie(SESSION,good.replace('Path=/','Path=/auth')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('Path=/','Path')),false);
});
test('rejects Secure or HttpOnly with a value',()=>{
  assert.equal(isPolicySetCookie(SESSION,good.replace('Secure','Secure=1')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('HttpOnly','HttpOnly=true')),false);
});
test('rejects Max-Age that is unbounded, negative, non-numeric or out of range',()=>{
  for(const age of ['Max-Age=','Max-Age=-1','Max-Age=abc','Max-Age=1e3','Max-Age=99999999','Max-Age=59','Max-Age=86401','Max-Age=0'])
    assert.equal(isPolicySetCookie(SESSION,good.replace('Max-Age=3600',age)),false,age);
});
test('an empty value is accepted only as a clearing cookie',()=>{
  assert.equal(isPolicySetCookie(SESSION,'desk_sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'),true);
  assert.equal(isPolicySetCookie(SESSION,'desk_sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600'),false);
});
test('rejects CR, LF and other control characters anywhere in the string',()=>{
  assert.equal(isPolicySetCookie(SESSION,`${good}\r\nSet-Cookie: x=y`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}\nX: y`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}\r`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}\t`),false);
  assert.equal(isPolicySetCookie(SESSION,`${good}\u0000`),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace(tok(43),`${tok(20)}\n${tok(22)}`)),false);
});
test('rejects an unexpected cookie name, including another application session or the binding cookie',()=>{
  assert.equal(isPolicySetCookie(SESSION,good.replace('desk_sid','field_sid')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('desk_sid','desk_sid_extra')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('desk_sid','DESK_SID')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace('desk_sid','__Host-desk_sid')),false);
  assert.equal(isPolicySetCookie(SESSION,`titan_desk_oidc_binding=${tok(43)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`),false);
  assert.equal(isPolicySetCookie(BINDING,good),false);
});
test('rejects a value that does not match the policy pattern or length',()=>{
  assert.equal(isPolicySetCookie(SESSION,good.replace(tok(43),'a'.repeat(31))),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace(tok(43),'a'.repeat(257))),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace(tok(43),'a=b')),false);
  assert.equal(isPolicySetCookie(SESSION,good.replace(tok(43),'a"b'+'a'.repeat(40))),false);
});
test('rejects non-strings, missing pairs and oversize strings without throwing',()=>{
  for(const v of [undefined,null,42,{},['x'],'','noequals; Path=/',`=${tok(43)}; Path=/`,`${good}; `,'x'.repeat(600)])
    assert.equal(isPolicySetCookie(SESSION,v),false);
});
