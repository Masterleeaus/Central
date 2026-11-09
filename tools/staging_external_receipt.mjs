#!/usr/bin/env node
/**
 * External Ed25519 receipt for an already-COMMITTED staging approval + audit.
 * No external runtime dependencies. An independently pinned public key is
 * required for verification; the database never stores the signing key.
 *
 * capture --database-url URL --approval-id UUID --output receipt.json
 * sign --receipt receipt.json --private-key signer.pem --output signed.json
 * verify --signed signed.json --public-key signer.pub.pem
 *        --trusted-key-sha256 <sha256 of SPKI DER> --database-url URL
 *
 * Receipt hashes can expose linkage to a known record. Keep files private.
 * This records an after-the-fact staging commitment, not prior human consent.
 */
import {
  createHash, createPrivateKey, createPublicKey, KeyObject, sign as signBytes,
  verify as verifyBytes, timingSafeEqual
} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const B64=/^[A-Za-z0-9+/]{86}==$/;
const RECEIPT_FIELDS=['schema','database','approval_id','event_id','approval_sha256','audit_sha256','captured_at'];
const SIGNED_FIELDS=['schema','receipt','signature_ed25519','public_key_spki_sha256'];
const STAGING_NAMES=new Set(['titan_shared_ci','titan_shared_staging','titan_shared_backfill_ci']);
const MAX_FILE=16384;

export function canonical(value) {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object') {
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  return JSON.stringify(value);
}
const sha=b=>createHash('sha256').update(b).digest('hex');
const own=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
export function validateReceipt(x) {
  if(!own(x,RECEIPT_FIELDS)||x.schema!=='titan.staging-external-receipt.v1'||
   !STAGING_NAMES.has(x.database)||!UUID.test(x.approval_id)||!UUID.test(x.event_id)||
   !SHA.test(x.approval_sha256)||!SHA.test(x.audit_sha256)||
   typeof x.captured_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x.captured_at)||
   !Number.isFinite(Date.parse(x.captured_at))) throw Error('invalid receipt');
  return x;
}
export function pin(publicKey) {
  const key=publicKey instanceof KeyObject && publicKey.type==='public' ? publicKey : createPublicKey(publicKey);
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 public key required');
  return sha(key.export({format:'der',type:'spki'}));
}
export function signedReceipt(receipt,privateKey) {
  validateReceipt(receipt);
  const key=privateKey instanceof KeyObject && privateKey.type==='private' ? privateKey : createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 signing key required');
  const pub=createPublicKey(key);
  const payload=Buffer.from('titan:staging-external-receipt:v1\n'+canonical(receipt),'utf8');
  return {schema:'titan.staging-signed-receipt.v1',receipt,
   signature_ed25519:signBytes(null,payload,key).toString('base64'),
   public_key_spki_sha256:pin(pub)};
}
export function validateSigned(x,publicKey,trustedPin) {
  if(!own(x,SIGNED_FIELDS)||x.schema!=='titan.staging-signed-receipt.v1'||
   typeof x.signature_ed25519!=='string'||!B64.test(x.signature_ed25519)||
   typeof x.public_key_spki_sha256!=='string'||!SHA.test(x.public_key_spki_sha256)||
   typeof trustedPin!=='string'||!SHA.test(trustedPin)) throw Error('invalid signed receipt');
  validateReceipt(x.receipt);
  const actual=pin(publicKey);
  const eq=(a,b)=>timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
  if(!eq(actual,trustedPin)||!eq(actual,x.public_key_spki_sha256))
    throw Error('untrusted receipt key');
  const bytes=Buffer.from(x.signature_ed25519,'base64');
  if(bytes.length!==64||!verifyBytes(null,
      Buffer.from('titan:staging-external-receipt:v1\n'+canonical(x.receipt)),
      publicKey instanceof KeyObject && publicKey.type==='public' ? publicKey : createPublicKey(publicKey),bytes)) throw Error('receipt signature mismatch');
  return x.receipt;
}
function q(record) {
 const id=record.approval_id;
 if(!UUID.test(id))throw Error('invalid approval identifier');
 // SQL is a fixed statement; UUID is strictly validated before interpolation.
 return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT row_to_json(t)::text FROM (
 SELECT current_database() AS database,
   a.approval_id::text AS approval_id, e.event_id::text AS event_id,
   a.evidence_sha256 AS approval_sha256, e.evidence_sha256 AS audit_sha256
 FROM titan.staging_backfill_approvals a
 JOIN titan.staging_backfill_audit e ON e.approval_id=a.approval_id
 WHERE a.approval_id='${id}'::uuid
   AND a.company_id=e.company_id AND a.identity_id=e.identity_id
   AND a.consumed_at IS NOT NULL AND e.result='staging_committed'
   AND a.evidence_sha256=titan.staging_approval_fingerprint(a)
   AND e.evidence_sha256=titan.staging_audit_fingerprint(e)
 ) t;
ROLLBACK;
`;
}
export function readCommitted(url,id,psql='psql') {
 if(typeof url!=='string'||!/^postgres(ql)?:\/\//.test(url)||!UUID.test(id))
   throw Error('invalid database URL or approval ID');
 const proc=spawnSync(psql,['-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-d',url],
   {input:q({approval_id:id}),encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 if(proc.error||proc.status!==0)throw Error('read-only database receipt query failed');
 const lines=proc.stdout.split(/\r?\n/).filter(x=>x.trim()&&!['BEGIN','ROLLBACK'].includes(x.trim()));
 if(lines.length!==1)throw Error('missing or ambiguous committed approval');
 let record;
 try {record=JSON.parse(lines[0]);}catch {throw Error('invalid committed approval response');}
 if(!own(record,['database','approval_id','event_id','approval_sha256','audit_sha256'])||
  record.approval_id.toLowerCase()!==id.toLowerCase()||
  !STAGING_NAMES.has(record.database)||!UUID.test(record.event_id)||
  !SHA.test(record.approval_sha256)||!SHA.test(record.audit_sha256))
  throw Error('unverified committed approval');
 return record;
}
function safeRead(path) {
 const bytes=readFileSync(path);
 if(bytes.length>MAX_FILE)throw Error('receipt input too large');
 try{return JSON.parse(bytes.toString('utf8'));}catch {throw Error('invalid JSON input');}
}
function saveNew(path,data) {
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,canonical(data)+'\n',{encoding:'utf8'});}finally{closeSync(fd);}
}
function parse(argv) {
 const [mode,...rest]=argv;
 if(!['capture','sign','verify','pin'].includes(mode)||rest.length%2!==0)
   throw Error('usage: capture|sign|verify|pin with named --options');
 const values={mode};
 for(let i=0;i<rest.length;i+=2) {
  if(!/^--[a-z-]+$/.test(rest[i])||Object.hasOwn(values,rest[i].slice(2)))
   throw Error('invalid option');
  values[rest[i].slice(2)]=rest[i+1];
 }
 return values;
}
export function main(argv=process.argv.slice(2)) {
 try {
  const o=parse(argv);
  if(o.mode==='pin') {
   if(!o['public-key'])throw Error('public key required');
   console.log(pin(readFileSync(o['public-key'])));return 0;
  }
  if(o.mode==='capture') {
   if(!o['database-url']||!o['approval-id']||!o.output)throw Error('missing capture arguments');
   const record=readCommitted(o['database-url'],o['approval-id']);
   const receipt={schema:'titan.staging-external-receipt.v1',...record,
     captured_at:new Date().toISOString()};
   validateReceipt(receipt);
   saveNew(o.output,receipt);
   console.log(JSON.stringify({status:'captured',production_execution_permitted:false}));return 0;
  }
  if(o.mode==='sign') {
   if(!o.receipt||!o['private-key']||!o.output)throw Error('missing sign arguments');
   const signed=signedReceipt(safeRead(o.receipt),readFileSync(o['private-key']));
   saveNew(o.output,signed);
   console.log(JSON.stringify({status:'signed',production_execution_permitted:false}));return 0;
  }
  if(!o.signed||!o['public-key']||!o['trusted-key-sha256']||!o['database-url'])
   throw Error('missing verification arguments');
  const receipt=validateSigned(safeRead(o.signed),
    readFileSync(o['public-key']),o['trusted-key-sha256']);
  const record=readCommitted(o['database-url'],receipt.approval_id);
  for(const k of ['database','approval_id','event_id','approval_sha256','audit_sha256']) {
   if(record[k]!==receipt[k])throw Error('database receipt mismatch');
  }
  console.log(JSON.stringify({status:'signature_and_database_match',
    independently_human_approved:false,production_execution_permitted:false}));
  return 0;
 }catch (error) {
  // Only a fixed catalogue of non-sensitive error classes may be printed.
  // Never show PostgreSQL stderr, connection URL, private paths or row data.
  const allowed=new Set([
    'missing or ambiguous committed approval',
    'unverified committed approval',
    'invalid committed approval response',
    'read-only database receipt query failed',
    'invalid receipt','receipt signature mismatch','untrusted receipt key',
    'database receipt mismatch','invalid signed receipt',
  ]);
  const kind=allowed.has(error?.message) ? ': '+error.message : '';
  console.error('external staging receipt operation denied or invalid'+kind);
  return 1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 process.exitCode=main();
