import {verifiedGrantOperator} from './grant-operator-context.mjs';
import {fail} from './errors.mjs';
/** Does not expose a public endpoint. Independently re-checks Logto operator roles
 * for every mutation, even when the caller was previously authenticated. */
export function createAuthorisedGrantWriter({writer,authoriseOperator,authorizeCompany}={}){
 if(typeof writer?.create!=='function'||typeof writer?.transition!=='function'||
 typeof authoriseOperator!=='function'||typeof authorizeCompany!=='function')fail('invalid_grant_authority');
 async function apply(principal,command,operation){
  const operator=await verifiedGrantOperator({principal,authoriseOperator});
  // Must consult canonical company authority; no claim from the client is sufficient.
  if(await authorizeCompany({operatorSubject:operator.subject,companyId:command?.companyId,
    product:command?.product,operation})!==true)fail('company_forbidden');
  const input={...command,actor:operator.subject};
  return operation==='create'?writer.create(input):writer.transition(input);
 }
 return Object.freeze({
  create:(principal,command)=>apply(principal,command,'create'),
  transition:(principal,command)=>apply(principal,command,'transition')
 });
}
