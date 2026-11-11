import {fail} from './errors.mjs';
/** Application must never choose among multiple active company grants. */
export function requireOneActiveGrant(rows) {
 if(!Array.isArray(rows)||rows.length!==1)fail('unauthorised');
 const row=rows[0];
 if(!row?.company_id||row.state!=='active'||row.company_status!=='active')fail('unauthorised');
 return row;
}
