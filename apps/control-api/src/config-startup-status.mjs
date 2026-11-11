/** Explicit startup state is read-only process metadata, never a bypass token. */
export function createConfigStartupStatus(){
 let phase='initializing',failure=null;
 return Object.freeze({
  get(){return Object.freeze({phase,failure})},
  ready(){if(phase!=='initializing')throw Error('invalid startup transition');phase='ready'},
  fail(code='unavailable'){if(phase!=='initializing')throw Error('invalid startup transition');phase='failed';failure=code},
  closed(){phase='closed'}
 });
}
