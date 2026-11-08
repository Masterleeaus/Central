/** One-use, browser-bound organisation selection coordinator (issues #32 and #44).
 * The caller supplies trusted organisation discovery, atomic durable state storage,
 * a current-authority recheck and the Central session issuer. No browser-supplied
 * identity or organisation is accepted without being checked against stored state.
 */
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
const validIssuer=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.href===value||(url.pathname==='/'&&url.origin===value));}catch{return false;}};
const hash=value=>createHash('sha256').update(value).digest('hex');
const equalHash=(left,right)=>{
  if(typeof left!=='string'||typeof right!=='string'||!/^[a-f0-9]{64}$/.test(left)||!/^[a-f0-9]{64}$/.test(right))return false;
  return timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
};

/**
 * listOrganisations({issuer,subject}) must return only organisations found through
 * trusted Central membership/access records. selectionStore.save/consume must be
 * durable and atomic across workers; consume deletes exactly once. verifySelection
 * MUST re-check current membership and product access for the selected tenant.
 * issueSession is invoked only after both the one-use and current-authority checks;
 * it should persist the session and set its cookie on the response in its closure,
 * then return exactly true. Session credentials are never returned by this module.
 */
export function createOrganisationSelection({selectionStore,listOrganisations,verifySelection,issueSession,
  clock=()=>Date.now(),randomState=()=>randomBytes(32).toString('base64url'),ttlMs=300_000}={}){
  if(typeof selectionStore?.save!=='function'||typeof selectionStore?.consume!=='function'||
     typeof listOrganisations!=='function'||typeof verifySelection!=='function'||typeof issueSession!=='function'||
     typeof clock!=='function'||typeof randomState!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>600_000)
    throw new TypeError('invalid organisation selection dependencies');

  return {
    async begin({issuer,subject,browserBinding}={}){
      if(!validIssuer(issuer)||!text(subject)||!TOKEN.test(browserBinding??''))return {status:'denied'};
      let raw;
      try{raw=await listOrganisations({issuer,subject});}catch{return {status:'unavailable'};}
      if(!Array.isArray(raw)||raw.length>128)return {status:'unavailable'};
      const seen=new Set(),organisations=[];
      for(const item of raw){
        if(!item||!UUID.test(item.id??'')||typeof item.name!=='string'||!item.name.trim()||item.name.length>160||/[\x00-\x1f\x7f]/.test(item.name)||seen.has(item.id))return {status:'unavailable'};
        seen.add(item.id);
        organisations.push({id:item.id,name:item.name.trim()});
      }
      if(organisations.length===0)return {status:'denied'};
      const state=randomState(),now=clock();
      if(!TOKEN.test(state)||!Number.isSafeInteger(now))return {status:'unavailable'};
      try{
        await selectionStore.save(state,{issuer,subject,bindingHash:hash(browserBinding),organisationIds:organisations.map(item=>item.id),expiresAt:now+ttlMs});
      }catch{return {status:'unavailable'};}
      return {status:'selection_required',state,organisations};
    },

    async complete({state,organisationId,browserBinding}={}){
      if(!TOKEN.test(state??'')||!UUID.test(organisationId??'')||!TOKEN.test(browserBinding??''))return {status:'denied'};
      let pending;
      try{pending=await selectionStore.consume(state);}catch{return {status:'unavailable'};}
      if(!pending||!validIssuer(pending.issuer)||!text(pending.subject)||!Array.isArray(pending.organisationIds)||
         !Number.isSafeInteger(pending.expiresAt)||pending.expiresAt<=clock()||
         !equalHash(pending.bindingHash,hash(browserBinding))||!pending.organisationIds.includes(organisationId))return {status:'denied'};
      let authorised;
      try{authorised=await verifySelection({issuer:pending.issuer,subject:pending.subject,organisationId});}
      catch{return {status:'unavailable'};}
      if(authorised!==true)return {status:'denied'};
      try{
        const issued=await issueSession({issuer:pending.issuer,subject:pending.subject,organisationId});
        if(issued!==true)return {status:'unavailable'};
        return {status:'selected'};
      }catch{return {status:'unavailable'};}
    }
  };
}
