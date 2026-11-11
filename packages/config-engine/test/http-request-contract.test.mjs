import test from 'node:test';
import assert from 'node:assert/strict';
import {flagsPath} from '../scripts/http-server-harness.mjs';
test('socket requests cannot choose a company identifier',()=>{
 const p=new URL(flagsPath,'http://localhost');
 assert.deepEqual([...p.searchParams.keys()].sort(),['application','environment','key']);
});
