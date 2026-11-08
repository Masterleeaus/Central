#!/usr/bin/env python3
"""Read-only reconciliation audit of legacy Central and canonical company databases.

No inserts, updates, writes, backfill or implicit company linking. The tool
reads separate bounded PostgreSQL snapshots and emits aggregate blocker counts
only; Logto subjects, company IDs and local user data never reach its report.

Usage:
 python3 tools/audit_company_reconciliation.py \
   --legacy-url "$TITAN_CENTRAL_DATABASE_URL" \
   --canonical-url "$TITAN_CENTRAL_SHARED_DATABASE_URL" \
   --output /secure/reconciliation.json

Exit 0: no blockers; 2: blockers; 1: connection/config/limit failure.
Zero blockers is NOT authorisation to migrate or approval of a mapping.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

MAX_ROWS = 10000
APPLICATIONS = {'field': 'sorted', 'desk': 'supercharged', 'academy': 'lms'}
ACTIVE = {'active', 'trialing'}
EXPIRY_TOLERANCE_SECONDS = 1
# Static, predetermined SQL only: never interpolate user data into queries.
LEGACY = {
 'companies': "SELECT id::text AS id,logto_organisation_id,state FROM titan.organisations",
 'identities': "SELECT id::text AS id,logto_subject,state FROM titan.identities",
 'memberships': "SELECT identity_id::text AS identity_id,organisation_id::text AS organisation_id,role,state,expires_at::text FROM titan.memberships",
 'entitlements': "SELECT organisation_id::text AS organisation_id,application_id,state,expires_at::text,features FROM titan.entitlements",
 'links': "SELECT identity_id::text AS identity_id,organisation_id::text AS organisation_id,application_id,state,local_user_id FROM titan.local_account_links",
}
CANONICAL = {
 'companies': "SELECT id::text AS id,status FROM titan.companies",
 'identities': "SELECT id::text AS id,logto_subject,status FROM titan.identities",
 'mappings': "SELECT legacy_organisation_id::text AS legacy_organisation_id,company_id::text AS company_id,logto_organisation_id,status,verified_at::text FROM titan.central_legacy_company_links",
 'memberships': "SELECT identity_id::text AS identity_id,company_id::text AS company_id,role,status,expires_at::text FROM titan.company_memberships",
 'entitlements': "SELECT company_id::text AS company_id,application_id,status,expires_at::text,features FROM titan.application_entitlements",
 'links': "SELECT identity_id::text AS identity_id,company_id::text AS company_id,application_id,status,local_user_id FROM titan.application_user_links",
}

def query_snapshot(url, query, *, psql='psql'):
    if not isinstance(url,str) or not url.startswith(('postgresql://','postgres://')):
        raise ValueError('PostgreSQL URL required')
    # A single transaction per bounded extraction; READ ONLY enforces zero
    # mutations even if a SQL statement were accidentally changed.
    sql = (
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'
      "SELECT row_to_json(t)::text FROM (" + query + f' LIMIT {MAX_ROWS + 1}' +
      ') t;\nROLLBACK;\n'
    )
    run=subprocess.run([psql,'-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-d',url],
      input=sql,capture_output=True,text=True,timeout=40,check=False)
    if run.returncode:
        # Never echo psql stderr (it can contain a connection URL or credentials).
        raise RuntimeError('read-only PostgreSQL snapshot failed')
    records=[]
    for raw in run.stdout.splitlines():
        if not raw.strip() or raw.startswith(('BEGIN','ROLLBACK')):continue
        try: row=json.loads(raw)
        except (ValueError,TypeError) as exc:raise RuntimeError('invalid snapshot row') from exc
        if not isinstance(row,dict):raise RuntimeError('invalid snapshot row')
        records.append(row)
        if len(records)>MAX_ROWS:raise RuntimeError('snapshot row limit exceeded')
    return records

def collect(legacy_url,canonical_url,*,psql='psql'):
    if legacy_url==canonical_url:raise ValueError('legacy and canonical database URLs must differ')
    return ({key:query_snapshot(legacy_url,sql,psql=psql) for key,sql in LEGACY.items()},
            {key:query_snapshot(canonical_url,sql,psql=psql) for key,sql in CANONICAL.items()})

def parse_expiry(value):
    """An explicit UTC instant or None. Naive/unparseable values are blockers."""
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > 64:
        raise ValueError('invalid expiry')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('invalid expiry') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('expiry timezone required')
    return parsed.astimezone(timezone.utc)

def compare_expiry(legacy_value,canonical_value,now):
    try:
        left=parse_expiry(legacy_value)
        right=parse_expiry(canonical_value)
    except (ValueError,OverflowError):
        return 'invalid'
    if (left is None) != (right is None):
        return 'mismatch'
    if left is None:
        return None
    if abs((left-right).total_seconds()) > EXPIRY_TOLERANCE_SECONDS:
        return 'mismatch'
    if (left > now) != (right > now):
        return 'access_mismatch'
    return None

def reconcile(legacy,canonical,*,now=None):
    """Pure, deterministic comparison; return aggregate findings without PII."""
    blockers=Counter()
    now = now if now is not None else datetime.now(timezone.utc)
    if not isinstance(now,datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('timezone-aware audit reference time required')
    now=now.astimezone(timezone.utc)
    row_counts={'legacy':{k:len(v) for k,v in legacy.items()},
                'canonical':{k:len(v) for k,v in canonical.items()}}
    companies={x['id']:x for x in legacy['companies']}
    canon_companies={x['id']:x for x in canonical['companies']}
    identities={x['id']:x for x in legacy['identities']}
    canon_identities={x['logto_subject']:x for x in canonical['identities']}
    mappings={}
    for link in canonical['mappings']:
        lid=link['legacy_organisation_id']
        if lid in mappings:blockers['ambiguous_company_mapping']+=1
        mappings[lid]=link
        old=companies.get(lid)
        if old is None:blockers['orphan_company_mapping']+=1;continue
        if old['logto_organisation_id']!=link['logto_organisation_id']:
            blockers['logto_organisation_mismatch']+=1
        if link['company_id'] not in canon_companies:
            blockers['missing_canonical_company']+=1
        if link['status']!='verified' or not link['verified_at']:
            blockers['unverified_company_mapping']+=1
        if old['state']=='active' and canon_companies.get(link['company_id'],{}).get('status')!='active':
            blockers['company_status_mismatch']+=1
    for lid in companies:
        if lid not in mappings:blockers['unmapped_legacy_company']+=1
    for identity in identities.values():
        target=canon_identities.get(identity['logto_subject'])
        if not target:blockers['missing_canonical_identity']+=1
        elif identity['state']!=target['status']:
            blockers['identity_status_mismatch']+=1
    canonical_members={(x['company_id'],x['identity_id']):x for x in canonical['memberships']}
    expected_members=set()
    for member in legacy['memberships']:
        mapping=mappings.get(member['organisation_id'])
        identity=identities.get(member['identity_id'])
        if mapping is None or mapping['status']!='verified' or identity is None:blockers['unresolvable_membership']+=1;continue
        target_identity=canon_identities.get(identity['logto_subject'])
        if not target_identity:continue  # reported as missing identity
        member_key=(mapping['company_id'],target_identity['id'])
        expected_members.add(member_key)
        target=canonical_members.get(member_key)
        if not target:blockers['missing_canonical_membership']+=1
        elif (member['role'],member['state']) != (target['role'],target['status']):
            blockers['membership_access_mismatch']+=1
        if target:
            expiry=compare_expiry(member.get('expires_at'),target.get('expires_at'),now)
            if expiry: blockers['membership_expiry_'+expiry]+=1
    mapped_companies={x['company_id'] for x in mappings.values() if x['status']=='verified'}
    for key,member in canonical_members.items():
        if key[0] in mapped_companies and key not in expected_members and member['status']=='active':
            blockers['unexpected_canonical_active_membership']+=1
    canonical_grants={(x['company_id'],x['application_id']):x for x in canonical['entitlements']}
    expected_grants=set()
    for grant in legacy['entitlements']:
        mapping=mappings.get(grant['organisation_id'])
        product=APPLICATIONS.get(grant['application_id'])
        if mapping is None or mapping['status']!='verified' or product is None:blockers['unresolvable_entitlement']+=1;continue
        grant_key=(mapping['company_id'],product)
        expected_grants.add(grant_key)
        target=canonical_grants.get(grant_key)
        if not target:blockers['missing_canonical_entitlement']+=1
        elif grant['state']!=target['status']:
            blockers['entitlement_status_mismatch']+=1
        elif set(grant.get('features') or [])!=set(target.get('features') or []):
            blockers['entitlement_features_mismatch']+=1
        if target:
            expiry=compare_expiry(grant.get('expires_at'),target.get('expires_at'),now)
            if expiry: blockers['entitlement_expiry_'+expiry]+=1
    for key,grant in canonical_grants.items():
        if key[0] in mapped_companies and key not in expected_grants and grant['status'] in ACTIVE:
            blockers['unexpected_canonical_active_entitlement']+=1
    canonical_links={(x['company_id'],x['identity_id'],x['application_id']):x for x in canonical['links']}
    expected_links=set()
    for link in legacy['links']:
        mapping=mappings.get(link['organisation_id'])
        identity=identities.get(link['identity_id'])
        product=APPLICATIONS.get(link['application_id'])
        if not mapping or mapping['status']!='verified' or not identity or not product:
            blockers['unresolvable_user_link']+=1;continue
        target_id=canon_identities.get(identity['logto_subject'])
        if not target_id:continue
        link_key=(mapping['company_id'],target_id['id'],product)
        expected_links.add(link_key)
        target=canonical_links.get(link_key)
        if not target:blockers['missing_canonical_user_link']+=1
        elif target['status']!=link['state'] or target['local_user_id']!=link['local_user_id']:
            blockers['user_link_mismatch']+=1
    for key,link in canonical_links.items():
        if key[0] in mapped_companies and key not in expected_links and link['status']=='verified':
            blockers['unexpected_canonical_verified_user_link']+=1
    return {'schema':'titan.company-reconciliation.v1','read_only':True,
            'migration_authorised':False,'snapshots_atomic_across_databases':False,
            'expiry_tolerance_seconds':EXPIRY_TOLERANCE_SECONDS,
            'row_counts':row_counts,'blockers':dict(sorted(blockers.items())),
            'blocker_count':sum(blockers.values()),
            'status':'requires_review' if blockers else 'no_discrepancies_in_compared_fields'}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-url',required=True)
    parser.add_argument('--canonical-url',required=True)
    parser.add_argument('--psql',default='psql')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args(argv)
    try:
        legacy,canonical=collect(args.legacy_url,args.canonical_url,psql=args.psql)
        result=reconcile(legacy,canonical)
        payload=json.dumps(result,indent=2,sort_keys=True)+'\n'
        if args.output:
            if args.output.exists():raise RuntimeError('refusing to overwrite reconciliation report')
            args.output.write_text(payload,encoding='utf-8')
        else:sys.stdout.write(payload)
        return 2 if result['blocker_count'] else 0
    except (ValueError,RuntimeError,subprocess.TimeoutExpired,OSError,KeyError) as exc:
        print('reconciliation audit unavailable: '+str(exc).split(':')[0],file=sys.stderr)
        return 1

if __name__=='__main__':
    raise SystemExit(main())
