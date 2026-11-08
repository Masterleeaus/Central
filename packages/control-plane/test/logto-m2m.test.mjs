import test from 'node:test';
import assert from 'node:assert/strict';
import {LogtoMachineTokenClient, createLogtoManagementTokenSupplier} from '../dist/logto-m2m.js';
let now=1_000_000;
const make=(fetcher,more={})=>new LogtoMachineTokenClient({issuerOrigin:'https://identity.test',clientId:'client123',clientSecret:'secret123',resource:'https://identity.test/api',scope:'all',clock:()=>now,fetcher,...more});
const success=(value='abcdefghijklmnop',seconds=3600)=>({ok:true,json:async()=>({access_token:value,expires_in:seconds,token_type:'Bearer'})});
test('uses exact token endpoint and client-credentials protocol',async()=>{
 const c=make(async(url,init)=>{assert.equal(url,'https://identity.test/oidc/token');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.headers['content-type'],'application/x-www-form-urlencoded');assert.equal(init.headers.authorization,'Basic '+Buffer.from('client123:secret123').toString('base64'));const b=new URLSearchParams(init.body);assert.equal(b.get('grant_type'),'client_credentials');assert.equal(b.get('resource'),'https://identity.test/api');assert.equal(b.get('scope'),'all');return success();});
 assert.equal(await c.accessToken(),'abcdefghijklmnop');
});
test('caches until expiring',async()=>{now=1_000_000;let calls=0;const c=make(async()=>{calls++;return success('abcdefghijklmnop',100)});await c.accessToken();await c.accessToken();assert.equal(calls,1);now+=80000;await c.accessToken();assert.equal(calls,2);});
test('deduplicates concurrent refresh',async()=>{let calls=0;const c=make(async()=>{calls++;await new Promise(r=>setTimeout(r,5));return success()});await Promise.all(Array.from({length:20},()=>c.accessToken()));assert.equal(calls,1);});
test('allows invalidation and renewal',async()=>{let calls=0;const c=make(async()=>{calls++;return success()});await c.accessToken();c.invalidate();await c.accessToken();assert.equal(calls,2);});
test('never includes secrets in rejection',async()=>{const c=make(async()=>({ok:false,status:401,json:async()=>({error:'secret123'})}));await assert.rejects(c.accessToken(),e=>!String(e).includes('secret123'));});
test('rejects invalid issuer origin and resource',()=>{assert.throws(()=>make(async()=>success(),{issuerOrigin:'http://evil.test'}));assert.throws(()=>make(async()=>success(),{issuerOrigin:'https://identity.test/path'}));assert.throws(()=>make(async()=>success(),{resource:'http://bad.test/api'}));});
test('rejects linebreak credentials',()=>assert.throws(()=>make(async()=>success(),{clientSecret:'bad\nsecret'})));
test('fails closed for malformed token response',async()=>{for(const payload of [null,{}, {access_token:'abcdefghijklmnop',token_type:'bearer',expires_in:10},{access_token:'short',token_type:'Bearer',expires_in:10},{access_token:'abcdefghijklmnop',token_type:'Bearer',expires_in:0}]){await assert.rejects(make(async()=>({ok:true,json:async()=>payload})).accessToken());}});
test('fails closed on network errors and can retry',async()=>{let call=0;const c=make(async()=>{if(!call++)throw Error('leak secret123');return success()});await assert.rejects(c.accessToken(),e=>!String(e).includes('secret123'));assert.equal(await c.accessToken(),'abcdefghijklmnop');});
test('supplier exposes fixed origin and token callback',async()=>{const supplier=createLogtoManagementTokenSupplier({issuerOrigin:'https://identity.test',clientId:'c',clientSecret:'s',resource:'https://identity.test/api',scope:'all',fetcher:async()=>success()});assert.equal(supplier.origin,'https://identity.test');assert.equal(await supplier.accessToken(),'abcdefghijklmnop');});
