import test from 'node:test';
import assert from 'node:assert/strict';
import {assertServiceRequest} from '../src/request-guard.mjs';
test('unverified headers and browser cookies are not service credentials',()=>{
 const req={method:'GET',headers:{authorization:'Bearer token'}};
 assert.equal(assertServiceRequest(req),'Bearer token');
 assert.throws(()=>assertServiceRequest({...req,headers:{...req.headers,cookie:'sid=1'}}));
 assert.throws(()=>assertServiceRequest({...req,headers:{...req.headers,'x-company-id':'other'}}));
});
