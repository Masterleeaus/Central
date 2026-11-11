import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServiceJwtVerifier} from '../src/jwt-verifier.mjs';
test('verifies RSA signature, issuer, audience and expiry',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk=publicKey.export({format:'jwk'}),issuer='https://login.example.test/',audience='https://central.example.test/config';
 const now=1_800_000_000;
 const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const token=payload=>{const h=encode({alg:'RS256',typ:'JWT',kid:'test'}),b=encode(payload),s=sign('RSA-SHA256',Buffer.from(h+'.'+b),privateKey).toString('base64url');return h+'.'+b+'.'+s};
 const verify=createServiceJwtVerifier({issuer,audience,jwksUri:'https://login.example.test/oidc/jwks',clock:()=>now*1000,fetcher:async()=>({ok:true,json:async()=>({keys:[{...jwk,kid:'test',use:'sig',alg:'RS256'}]})})});
 const claims={iss:issuer,aud:audience,sub:'service_1',client_id:'config_service',iat:now-10,exp:now+100};
 assert.equal((await verify('Bearer '+token(claims))).clientId,'config_service');
 await assert.rejects(verify('Bearer '+token({...claims,aud:'https://other.test/'})));
 await assert.rejects(verify('Bearer '+token({...claims,exp:now-100})));
 await assert.rejects(verify('Bearer '+token({...claims,sub:'a'}).slice(0,-2)+'xx'));
});
