import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigRoute} from '../src/config-route.mjs';
test('route disabled without opt-in or trusted resolver',()=>{
 assert.equal(createConfigRoute({env:{}}),undefined);
 assert.throws(()=>createConfigRoute({env:{TITAN_CONFIG_ENABLED:'true'},pool:{connect(){}},lookup:null}));
});
test('rate limit applies before authentication',async()=>{
 const env={TITAN_CONFIG_ENABLED:'true',TITAN_OIDC_ISSUER:'https://login.test/',TITAN_OIDC_JWKS_URI:'https://login.test/oidc/jwks',TITAN_CONFIG_AUDIENCE:'https://api.test/config',TITAN_CONFIG_SALT:'long-private-secret-value'};
 const handler=createConfigRoute({env,pool:{connect(){}},lookup:async()=>{},limits:{limit:1,windowMs:60000}});
 const res=()=>({writeHead(s){this.status=s},end(){}});
 await handler({url:'/v1/config/evaluate?key=x&application=central&environment=stage',method:'GET',headers:{}},res());
 const second=res();await handler({url:'/v1/config/evaluate?key=x&application=central&environment=stage',method:'GET',headers:{}},second);
 assert.equal(second.status,429);
});
