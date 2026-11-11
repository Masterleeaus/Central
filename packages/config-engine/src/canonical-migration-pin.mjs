import {fail} from './errors.mjs';
export const CANONICAL_MIGRATION_SHA='3c026a42069d60cdb9315ddd8f7ca162a44a10c7';
export function requirePinnedCanonicalMigration(value){
 if(value!==CANONICAL_MIGRATION_SHA)fail('untrusted_canonical_migration');
 return value;
}
