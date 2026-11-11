#!/usr/bin/env python3
"""Privileged, read-only integrity check of Titan staging approval/audit records.

Checks PostgreSQL's immutable row fingerprints and one-to-one consumed
approval/audit linkage. Emits aggregate counts only. A matching digest
is NOT a human signature or assurance against a hostile database owner.

Exit 0 verified, 2 detected mismatch, 1 unavailable/invalid report.
"""
import argparse
import json
import subprocess
import sys

SQL=(
 "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
 "SELECT row_to_json(t)::text FROM ("
 "SELECT approvals_checked,audits_checked,mismatched_approvals,"
 "mismatched_audits,missing_success_events "
 "FROM titan.verify_staging_backfill_integrity()) t;\n"
 "ROLLBACK;\n"
)
KEYS=('approvals_checked','audits_checked','mismatched_approvals',
      'mismatched_audits','missing_success_events')

def validate(rows):
    if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict):
        raise ValueError('integrity report missing or ambiguous')
    entry=rows[0]
    if set(entry)!=set(KEYS) or any(type(entry[k]) is not int or entry[k]<0 for k in KEYS):
        raise ValueError('integrity report values invalid')
    if entry['mismatched_approvals']>entry['approvals_checked'] or (
       entry['mismatched_audits']>entry['audits_checked']):
        raise ValueError('integrity report totals invalid')
    return {'schema':'titan.staging-approval-integrity.v1',
            'read_only':True,'human_signature_verified':False,
            'db_superuser_tamper_resistant':False,
            **entry,
            'status':'integrity_verified_within_database' if all(
             entry[k]==0 for k in KEYS[2:]) else 'integrity_violation'}

def check(url,*,psql='psql'):
    if not isinstance(url,str) or not url.startswith(('postgresql://','postgres://')):
        raise ValueError('PostgreSQL URL required')
    try:
        proc=subprocess.run([psql,'-X','-A','-t','-q','-v','ON_ERROR_STOP=1',
                             '-d',url],input=SQL,capture_output=True,text=True,
                            timeout=30,check=False)
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise ValueError('PostgreSQL integrity check unavailable') from exc
    if proc.returncode:
        raise ValueError('PostgreSQL integrity check denied')
    try:
        records=[json.loads(line) for line in proc.stdout.splitlines()
                 if line.strip() and line.strip() not in ('BEGIN','ROLLBACK')]
    except (ValueError,TypeError) as exc:
        raise ValueError('invalid PostgreSQL integrity output') from exc
    return validate(records)

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--database-url',required=True)
    p.add_argument('--psql',default='psql')
    a=p.parse_args(argv)
    try:
        result=check(a.database_url,psql=a.psql)
        print(json.dumps(result,sort_keys=True,indent=2))
        return 0 if result['status']=='integrity_verified_within_database' else 2
    except ValueError:
        print('staging integrity verification unavailable or denied',file=sys.stderr)
        return 1

if __name__=='__main__':
    raise SystemExit(main())
