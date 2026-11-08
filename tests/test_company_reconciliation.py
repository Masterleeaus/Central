"""Safe, read-only cross-database reconciliation regression tests."""
import importlib.util
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'tools/audit_company_reconciliation.py')
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
A='00000000-0000-4000-8000-000000000001'
B='00000000-0000-4000-8000-000000000002'
I='00000000-0000-4000-8000-000000000101'
J='00000000-0000-4000-8000-000000000201'
def source():
    return {
      'companies':[{'id':A,'logto_organisation_id':'org-a','state':'active'}],
      'identities':[{'id':I,'logto_subject':'person-a','state':'active'}],
      'memberships':[{'identity_id':I,'organisation_id':A,'role':'owner','state':'active','expires_at':None}],
      'entitlements':[{'organisation_id':A,'application_id':'field','state':'active','expires_at':None,'features':[]}],
      'links':[{'identity_id':I,'organisation_id':A,'application_id':'field','state':'verified','local_user_id':'user-a'}]}
def target():
    return {
      'companies':[{'id':B,'status':'active'}],
      'identities':[{'id':J,'logto_subject':'person-a','status':'active'}],
      'mappings':[{'legacy_organisation_id':A,'company_id':B,'logto_organisation_id':'org-a','status':'verified','verified_at':'2026-01-01'}],
      'memberships':[{'identity_id':J,'company_id':B,'role':'owner','status':'active','expires_at':None}],
      'entitlements':[{'company_id':B,'application_id':'sorted','status':'active','expires_at':None,'features':[]}],
      'links':[{'identity_id':J,'company_id':B,'application_id':'sorted','status':'verified','local_user_id':'user-a'}]}
class AuditTests(unittest.TestCase):
    def test_complete_verified_mappings_have_no_compared_discrepancies(self):
        r=audit.reconcile(source(),target())
        self.assertEqual(r['blocker_count'],0)
        self.assertFalse(r['migration_authorised'])
        self.assertFalse(r['snapshots_atomic_across_databases'])
        self.assertEqual(r['row_counts']['legacy']['memberships'],1)
        self.assertNotIn('person-a',str(r))
        self.assertNotIn(A,str(r))
    def test_no_mapping_blocks_company_and_access_reconciliation(self):
        c=target();c['mappings']=[]
        r=audit.reconcile(source(),c)
        self.assertEqual(r['blockers']['unmapped_legacy_company'],1)
        self.assertEqual(r['blockers']['unresolvable_membership'],1)
        self.assertEqual(r['blockers']['unresolvable_entitlement'],1)
        self.assertEqual(r['blockers']['unresolvable_user_link'],1)
    def test_pending_mapping_does_not_count_as_approved(self):
        c=target();c['mappings'][0]['status']='pending';c['mappings'][0]['verified_at']=None
        r=audit.reconcile(source(),c)
        self.assertEqual(r['blockers']['unverified_company_mapping'],1)
    def test_wrong_logto_identity_or_company_pair_detected(self):
        c=target()
        c['mappings'][0]['logto_organisation_id']='spoof'
        c['identities'][0]['logto_subject']='imposter'
        r=audit.reconcile(source(),c)
        self.assertEqual(r['blockers']['logto_organisation_mismatch'],1)
        self.assertEqual(r['blockers']['missing_canonical_identity'],1)
        self.assertNotIn('imposter',str(r))
    def test_role_grant_link_state_and_user_mismatch_detected(self):
        c=target()
        c['memberships'][0]['role']='learner'
        c['entitlements'][0]['status']='paused'
        c['links'][0]['local_user_id']='other-user'
        r=audit.reconcile(source(),c)
        self.assertEqual(r['blockers']['membership_access_mismatch'],1)
        self.assertEqual(r['blockers']['entitlement_status_mismatch'],1)
        self.assertEqual(r['blockers']['user_link_mismatch'],1)
    def test_sql_snapshot_is_bounded_explicitly_read_only_and_sanitised(self):
        from unittest.mock import patch
        class Result:returncode=0;stdout='{"id":"abc"}\n';stderr=''
        with patch.object(audit.subprocess,'run',return_value=Result()) as run:
            rows=audit.query_snapshot('postgresql://test@localhost:5432/legacy',audit.LEGACY['companies'])
        self.assertEqual(rows,[{'id':'abc'}])
        script=run.call_args.kwargs['input']
        self.assertIn('ISOLATION LEVEL REPEATABLE READ READ ONLY',script)
        self.assertIn('LIMIT 10001',script)
        self.assertIn('ROLLBACK;',script)
    def test_failing_psql_never_emits_credentials(self):
        from unittest.mock import patch
        class Result:returncode=1;stdout='';stderr='FATAL secret_password'
        with patch.object(audit.subprocess,'run',return_value=Result()):
            with self.assertRaisesRegex(RuntimeError,'snapshot failed') as error:
                audit.query_snapshot('postgresql://user:secret_password@localhost:5432/test','SELECT 1')
            self.assertNotIn('secret_password',str(error.exception))
