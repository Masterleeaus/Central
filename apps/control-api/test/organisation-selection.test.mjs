import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrganisationSelection} from '../src/organisation-selection.mjs';

const orgA='00000000-0000-4000-8000-000000000001';
const orgB='00000000-0000-4000-8000-000000000002';
const state='s'.repeat(43),binding='b'.repeat(43);
function setup({organisations=[{id:orgA,name:'A & Co'},{id:orgB,name:'B Co'}],verify=true,throwVerify=false}={}){
  const saved=new Map(),calls={verify:[],issued:[]};
  const selection=createOrganisationSelection({
    selectionStore:{async save(key,value){saved.set(key,value)},async consume(key){const value=saved.get(key);saved.delete(key);return value??null}},
    listOrganisations:async()=>organisations,
    verifySelection:async args=>{calls.verify.push(args);if(throwVerify)throw Error('internal detail');return verify},
    issueSession:async args=>{calls.issued.push(args);return 'opaque-session'},
    clock:()=>1_000,randomState:()=>state,
  });
  return {selection,saved,calls};
}

test('selection state is browser-bound, expires, and stores only trusted tenant choices',async()=>{
  const {selection,saved}=setup();
  const result=await selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding});
  assert.deepEqual(result,{status:'selection_required',state,organisations:[{id:orgA,name:'A & Co'},{id:orgB,name:'B Co'}]});
  assert.deepEqual(saved.get(state).organisationIds,[orgA,orgB]);
  assert.match(saved.get(state).bindingHash,/^[a-f0-9]{64}$/);
  assert.notEqual(saved.get(state).bindingHash,binding);
  assert.equal('browserBinding' in saved.get(state),false);
});

test('tampered, foreign, and unlisted company selections fail before recheck or session issue',async()=>{
  for(const input of [
    {state:'x'.repeat(43),organisationId:orgA,browserBinding:binding},
    {state,organisationId:'00000000-0000-4000-8000-000000000003',browserBinding:binding},
    {state,organisationId:orgA,browserBinding:'x'.repeat(43)},
  ]){
    const {selection,calls}=setup();
    await selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding});
    assert.deepEqual(await selection.complete(input),{status:'denied'});
    assert.equal(calls.verify.length,0);assert.equal(calls.issued.length,0);
  }
});

test('rechecks current authority and issues a session only after a verified selection',async()=>{
  const {selection,calls}=setup();
  await selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding});
  const result=await selection.complete({state,organisationId:orgB,browserBinding:binding});
  assert.deepEqual(result,{status:'selected',session:'opaque-session'});
  assert.deepEqual(calls.verify,[{issuer:'https://id.example/',subject:'subject-1',organisationId:orgB}]);
  assert.deepEqual(calls.issued,[{issuer:'https://id.example/',subject:'subject-1',organisationId:orgB}]);
});

test('membership revoked after choices were listed denies selection',async()=>{
  const {selection,calls}=setup({verify:false});
  await selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding});
  assert.deepEqual(await selection.complete({state,organisationId:orgA,browserBinding:binding}),{status:'denied'});
  assert.equal(calls.verify.length,1);assert.equal(calls.issued.length,0);
});

test('selection token is one-use even when subsequent membership recheck fails',async()=>{
  const {selection,calls}=setup({verify:false});
  await selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding});
  const request={state,organisationId:orgA,browserBinding:binding};
  assert.deepEqual(await selection.complete(request),{status:'denied'});
  assert.deepEqual(await selection.complete(request),{status:'denied'});
  assert.equal(calls.verify.length,1);
});

test('invalid discovery records and storage failures fail closed',async()=>{
  assert.deepEqual(await setup({organisations:[{id:orgA,name:'A'},{id:orgA,name:'duplicate'}]}).selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding}),{status:'unavailable'});
  const bad=createOrganisationSelection({selectionStore:{save:async()=>{throw Error()},consume:async()=>null},listOrganisations:async()=>[{id:orgA,name:'A'}],verifySelection:async()=>true,issueSession:async()=>true,clock:()=>1_000,randomState:()=>state});
  assert.deepEqual(await bad.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding}),{status:'unavailable'});
});

test('no choices denies and recheck failure never issues a session',async()=>{
  assert.deepEqual(await setup({organisations:[]}).selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding}),{status:'denied'});
  const {selection,calls}=setup({throwVerify:true});
  await selection.begin({issuer:'https://id.example/',subject:'subject-1',browserBinding:binding});
  assert.deepEqual(await selection.complete({state,organisationId:orgA,browserBinding:binding}),{status:'unavailable'});
  assert.equal(calls.issued.length,0);
});
