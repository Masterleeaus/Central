/** No email/company/role inputs. The organisationId is Central's UUID, server-resolved by the product. */
const ID=/^[A-Za-z0-9:_-]{1,200}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE=/^[A-Za-z0-9_-]{32,128}$/;
const keys=['applicationId','issuer','organisationId','requestId','subject'];
export function parseServiceDecisionRequest(body,issuer){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join('|')!==keys.sort().join('|')||
  body.applicationId!=='academy'||body.issuer!==issuer||typeof body.subject!=='string'||!ID.test(body.subject)||
  typeof body.organisationId!=='string'||!UUID.test(body.organisationId)||
  typeof body.requestId!=='string'||!NONCE.test(body.requestId))return null;
 return {applicationId:'academy',issuer,subject:body.subject,requestId:body.requestId,organisationId:body.organisationId};
}
export async function readServiceDecisionBody(req){
 if(typeof req.headers['content-type']!=='string'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']))
 throw Error('unsupported_media_type');
 let bytes=0;const chunks=[];
 for await(const chunk of req){const buf=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buf.length;
  if(bytes>2048)throw Error('body_too_large');chunks.push(buf);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('invalid_json');}
}
