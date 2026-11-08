#!/usr/bin/env python3
"""Deterministic, non-executing staging plan for legacy -> canonical access data.

Never emits DML, UUIDs, subjects, access links, names or migration authorisation.
Only *previously verified* company links can be used. Candidate identities
may be new, but assigning their canonical UUIDs requires a separate, reviewed
provisioning process. Membership/entitlement/link candidates are emitted only
where a canonical identity and verified company already exist.

Usage: python3 tools/plan_company_backfill.py --legacy-url ... --canonical-url ...
Exit 0 only when no conflicts; exit 2 for blockers; exit 1 on read failure.
"""
import argparse
import hashlib
import json
import sys

from audit_company_reconciliation import collect, APPLICATIONS, parse_expiry

def plan(legacy,canonical):
    findings={}
    def fail(reason):
        findings[reason]=findings.get(reason,0)+1
    for side,db in [('legacy',legacy),('canonical',canonical)]:
        for field,rows in db.items():
            if not isinstance(rows,list):
                raise ValueError('invalid snapshot dataset')
            # Do not infer duplicates away: source collisions are blockers.
    old_org={r['id']:r for r in legacy['companies']}
    canonical_org={r['id']:r for r in canonical['companies']}
    old_subject={r['id']:r for r in legacy['identities']}
    canonical_subject={}
    canonical_identity_ids=set()
    for row in canonical['identities']:
        if row['logto_subject'] in canonical_subject or row['id'] in canonical_identity_ids:
            fail('ambiguous_canonical_identity')
        canonical_subject[row['logto_subject']]=row
        canonical_identity_ids.add(row['id'])
    approved={}
    seen_targets=set()
    for mapping in canonical['mappings']:
        source=mapping['legacy_organisation_id']
        target=mapping['company_id']
        if source in approved or target in seen_targets:
            fail('ambiguous_company_link')
        approved[source]=mapping
        seen_targets.add(target)
        if mapping['status']!='verified' or not mapping['verified_at']:
            fail('unverified_mapping')
        elif (source not in old_org or target not in canonical_org or
              old_org[source]['logto_organisation_id']!=mapping['logto_organisation_id']):
            fail('mapping_identity_conflict')
        elif old_org[source]['state']!='active' or canonical_org[target]['status']!='active':
            fail('inactive_mapped_company')
    for org in old_org:
        if org not in approved:fail('missing_approved_company_mapping')
    for row in legacy['identities']:
        if row['id'] not in old_subject: fail('invalid_identity')
    candidates={'identities':0,'memberships':0,'entitlements':0,'user_links':0}
    for row in old_subject.values():
        existing=canonical_subject.get(row['logto_subject'])
        if not existing:
            candidates['identities']+=1
        elif existing['status']!=row['state']:
            fail('identity_status_conflict')
    seen_member=set()
    canonical_member={(r['company_id'],r['identity_id']):r for r in canonical['memberships']}
    for row in legacy['memberships']:
        mapping=approved.get(row['organisation_id'])
        source=old_subject.get(row['identity_id'])
        if not mapping or mapping['status']!='verified' or not source:
            fail('unresolved_membership');continue
        identity=canonical_subject.get(source['logto_subject'])
        if not identity:
            fail('identity_requires_approved_provisioning');continue
        key=(mapping['company_id'],identity['id'])
        if key in seen_member:fail('duplicate_source_membership');continue
        seen_member.add(key)
        existing=canonical_member.get(key)
        if existing:
            if (existing['role'],existing['status'],existing.get('expires_at')) != (
                    row['role'],row['state'],row.get('expires_at')):
                fail('membership_conflict')
        else:
            candidates['memberships']+=1
        if row.get('expires_at') is not None:
            try:parse_expiry(row['expires_at'])
            except ValueError:fail('invalid_membership_expiry')
    canonical_grant={(r['company_id'],r['application_id']):r for r in canonical['entitlements']}
    seen_grants=set()
    for row in legacy['entitlements']:
        mapping=approved.get(row['organisation_id'])
        product=APPLICATIONS.get(row['application_id'])
        if not mapping or mapping['status']!='verified' or not product:
            fail('unresolved_entitlement');continue
        key=(mapping['company_id'],product)
        if key in seen_grants:fail('duplicate_source_entitlement');continue
        seen_grants.add(key)
        existing=canonical_grant.get(key)
        if existing:
            if (existing['status'],sorted(existing.get('features') or []),existing.get('expires_at')) != (
                    row['state'],sorted(row.get('features') or []),row.get('expires_at')):
                fail('entitlement_conflict')
        else:
            candidates['entitlements']+=1
        if row.get('expires_at') is not None:
            try:parse_expiry(row['expires_at'])
            except ValueError:fail('invalid_entitlement_expiry')
    canonical_links={(r['company_id'],r['identity_id'],r['application_id']):r for r in canonical['links']}
    seen_links=set()
    for row in legacy['links']:
        mapping=approved.get(row['organisation_id'])
        source=old_subject.get(row['identity_id'])
        product=APPLICATIONS.get(row['application_id'])
        if not mapping or mapping['status']!='verified' or not source or not product:
            fail('unresolved_user_link');continue
        identity=canonical_subject.get(source['logto_subject'])
        if not identity:
            fail('user_link_requires_approved_identity');continue
        key=(mapping['company_id'],identity['id'],product)
        if key in seen_links:fail('duplicate_source_user_link');continue
        seen_links.add(key)
        existing=canonical_links.get(key)
        if existing:
            if (existing['status'],existing['local_user_id'])!=(row['state'],row['local_user_id']):
                fail('user_link_conflict')
        else:candidates['user_links']+=1
    # Canonical rows may exist from other sources; never update or delete them.
    return {'schema':'titan.company-backfill-plan.v1',
            'source':'read_only_snapshots',
            'writes_permitted':False,'migration_authorised':False,
            'new_company_creation_permitted':False,
            'requires_separate_signed_approval':True,
            'candidate_counts':candidates,
            'conflicts':dict(sorted(findings.items())),
            'conflict_count':sum(findings.values()),
            'status':'blocked' if findings else 'candidate_review_only'}

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--legacy-url',required=True)
    p.add_argument('--canonical-url',required=True)
    args=p.parse_args(argv)
    try:
        legacy,canonical=collect(args.legacy_url,args.canonical_url)
        result=plan(legacy,canonical)
        print(json.dumps(result,sort_keys=True,indent=2))
        return 2 if result['conflict_count'] else 0
    except (KeyError,TypeError,ValueError,RuntimeError,OSError):
        print('backfill planning unavailable: invalid or inaccessible source',file=sys.stderr)
        return 1
if __name__=='__main__':
    raise SystemExit(main())
