#!/usr/bin/env python3
"""Non-mutating migration-preflight gate for Titan canonical company cutover.

This gate NEVER performs a migration. It evaluates an aggregate reconciliation
report plus explicit independent human/operational evidence flags and emits
a machine-readable *review plan*. It cannot approve a cutover. An operator
must separately execute a reviewed migration plan after backup verification,
freeze, Logto authority verification and rollback rehearsals.

Usage:
 python3 tools/plan_company_cutover.py --reconciliation /secure/report.json \
   --output /secure/cutover-preflight.json

Exit 2 for blocked/incomplete, 1 for unreadable/invalid inputs, 0 for all
readiness checks satisfied (but execution is always forbidden).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

EXPECTED_SCHEMA='titan.company-reconciliation.v1'
CHECKS=(
 'source_backups_restorable',
 'sources_quiesced_for_comparison',
 'company_mappings_reviewed',
 'logto_membership_authority_verified',
 'product_session_compatibility_verified',
 'rollback_rehearsed',
 'canonical_rls_roles_verified',
 'production_change_approved',
)

def generate(report, evidence=None):
    if not isinstance(report,dict) or report.get('schema')!=EXPECTED_SCHEMA:
        raise ValueError('unsupported reconciliation schema')
    count=report.get('blocker_count')
    flags=report.get('blockers')
    if type(count) is not int or count<0 or not isinstance(flags,dict) or any(
        not isinstance(k,str) or type(v) is not int or v<0 for k,v in flags.items()):
        raise ValueError('invalid discrepancy counts')
    if sum(flags.values())!=count:
        raise ValueError('inconsistent discrepancy totals')
    if report.get('read_only') is not True or report.get('migration_authorised') is not False or report.get('snapshots_atomic_across_databases') is not False:
        raise ValueError('untrusted reconciliation safety flags')
    counts=report.get('row_counts')
    if not isinstance(counts,dict) or any(
        not isinstance(counts.get(source),dict) or any(
            type(v) is not int or v<0 for v in counts[source].values()
        ) for source in ('legacy','canonical')):
        raise ValueError('invalid reconciliation row counts')
    if evidence is None:evidence={}
    if not isinstance(evidence,dict) or any(k not in CHECKS for k in evidence):
        raise ValueError('unrecognised evidence checklist field')
    if any(type(v) is not bool for v in evidence.values()):
        raise ValueError('invalid evidence checklist value')
    required={check:evidence.get(check) is True for check in CHECKS}
    ready=(count==0 and all(required.values()) and report.get('snapshots_consistent_within_each_database') is True)
    return {
      'schema':'titan.company-cutover-preflight.v1',
      'status':'ready_for_separate_human_review' if ready else 'blocked',
      'blocker_count':count,
      'missing_gates':[key for key,passed in required.items() if not passed],
      'same_database_snapshot_consistency':report.get('snapshots_consistent_within_each_database') is True,
      'cross_database_atomic_snapshot':False,
      'migration_authorised':False,
      'writes_permitted':False,
      'next_steps':[
        'Freeze source and target writes; take independently verified backups.',
        'Verify authoritative Logto and product-specific access semantics.',
        'Review exact identity/company mappings, expiry policies and user links.',
        'Re-run reconciliation on stable copies before signed change approval.',
        'Rehearse a reversible cutover before planning any production writes.'
      ]
    }

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reconciliation',type=Path,required=True)
    parser.add_argument('--evidence',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args(argv)
    try:
        report=json.loads(args.reconciliation.read_text(encoding='utf-8'))
        evidence=json.loads(args.evidence.read_text(encoding='utf-8')) if args.evidence else None
        plan=generate(report,evidence)
        payload=json.dumps(plan,sort_keys=True,indent=2)+'\n'
        if args.output:
            if args.output.exists():raise ValueError('refusing to overwrite preflight')
            args.output.write_text(payload,encoding='utf-8')
        else:sys.stdout.write(payload)
        return 0 if plan['status']=='ready_for_separate_human_review' else 2
    except (OSError,ValueError,TypeError,KeyError):
        print('cutover preflight unavailable: invalid or unreadable report/evidence',file=sys.stderr)
        return 1
if __name__=='__main__':
    raise SystemExit(main())
