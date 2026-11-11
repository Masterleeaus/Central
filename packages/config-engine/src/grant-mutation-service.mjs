import {createAuthorisedGrantWriter} from './authorised-grant-writer.mjs';
import {validateGrantChangeBody} from './grant-change-boundary.mjs';
/** Safe server composition for a separately authenticated operator. No routes.
 * The verified principal is a separate argument, never part of command JSON. */
export function createGrantMutationService(config){
 const writer=createAuthorisedGrantWriter(config);
 return Object.freeze({
  create:async({principal,command})=>writer.create(principal,validateGrantChangeBody(command,'create')),
  transition:async({principal,command})=>writer.transition(principal,validateGrantChangeBody(command,'transition'))
 });
}
