import {fail} from './errors.mjs';
export const CANONICAL_MIGRATION_ID='0001_shared_company_core';
export function assertMigrationReceipt({expectedId=CANONICAL_MIGRATION_ID,expectedHash,rows}={}){
 if(expectedId!==CANONICAL_MIGRATION_ID||typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash))fail('unapproved_migration_checksum');
 if(!Array.isArray(rows)||rows.length!==1)fail('missing_canonical_migration_receipt');
 const r=rows[0];
 if(r.migration_id!==expectedId||r.checksum_sha256!==expectedHash)fail('canonical_migration_checksum_mismatch');
 return Object.freeze({migrationId:expectedId,checksum:expectedHash});
}
