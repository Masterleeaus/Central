import test from 'node:test';
import assert from 'node:assert/strict';
import {createM2MGateway} from '../src/m2m-gateway.mjs';
test('gateway rejects missing authoritative registry',()=>assert.throws(()=>createM2MGateway({issuer:'https://login.example.test/',audience:'https://api.example.test/config'})));
