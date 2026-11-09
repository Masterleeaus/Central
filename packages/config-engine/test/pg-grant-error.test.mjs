import test from 'node:test';
import assert from 'node:assert/strict';
import {createPgGrantRegistry} from '../src/pg-grant-registry.mjs';
test('query failure rolls back and connection is released',async()=>{
 const commands=[];let released=false;
 const c={query:async q=>{commands.push(q);if(q.includes('SELECT product,environment'))throw Error('offline');return{rows:[]}},release:()=>released=true};
 await assert.rejects(createPgGrantRegistry({pool:{connect:async()=>c}})({clientId:'svc',application:'central',environment:'stage'}));
 assert.equal(commands.at(-1),'ROLLBACK');assert.ok(released);
});
