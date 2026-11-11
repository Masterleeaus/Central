import {createPgCompanyGrantAuthority} from './pg-company-authority.mjs';
import {createPgGrantWriter} from './pg-grant-writer.mjs';
import {createGrantMutationService} from './grant-mutation-service.mjs';
import {fail} from './errors.mjs';
/** Operator identity and Logto authority are injected by the trusted backend.
 * This factory installs no public HTTP route. */
export function createCanonicalGrantService({authorityPool,writerPool,authoriseOperator,clock}={}){
 if(typeof authoriseOperator!=='function')fail('missing_operator_authority');
 return createGrantMutationService({writer:createPgGrantWriter({pool:writerPool}),
  authorizeCompany:createPgCompanyGrantAuthority({pool:authorityPool,clock}),
  authoriseOperator});
}
