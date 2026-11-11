"""Staging approval integrity verification must report no private row data."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import verify_staging_approval_integrity as audit

def entry(**updates):
    values=dict(approvals_checked=4,audits_checked=2,
                mismatched_approvals=0,mismatched_audits=0,missing_success_events=0)
    values.update(updates)
    return values

class IntegrityAuditTests(unittest.TestCase):
    def test_clean_hashes_and_linkage_are_explicitly_not_a_human_signature(self):
        result=audit.validate([entry()])
        self.assertEqual(result['status'],'integrity_verified_within_database')
        self.assertFalse(result['human_signature_verified'])
        self.assertFalse(result['db_superuser_tamper_resistant'])
        self.assertNotIn('logto_subject',str(result))
    def test_mismatch_in_either_table_or_linkage_blocks(self):
        for changed in (
            dict(mismatched_approvals=1),
            dict(mismatched_audits=1),
            dict(missing_success_events=1)
        ):
            result=audit.validate([entry(**changed)])
            self.assertEqual(result['status'],'integrity_violation')
    def test_invalid_or_forged_result_fails_closed(self):
        for bad in (
            [],[entry(),entry()],['not a record'],
            [dict(entry(),unknown_secret='data')],
            [entry(approvals_checked=True)],
            [entry(mismatched_approvals=5)],
            [entry(mismatched_audits=-1)]
        ):
            with self.assertRaises(ValueError):
                audit.validate(bad)
    def test_database_query_enforces_read_only_transaction(self):
        import json
        class Result:
            returncode=0
            stdout=json.dumps(entry())+'\n'
            stderr=''
        with patch.object(audit.subprocess,'run',return_value=Result()) as runner:
            result=audit.check('postgresql://tester:private@localhost/titan_shared_ci')
        self.assertEqual(result['status'],'integrity_verified_within_database')
        self.assertIn('REPEATABLE READ READ ONLY',runner.call_args.kwargs['input'])
        self.assertIn('ROLLBACK;',runner.call_args.kwargs['input'])
    def test_database_failure_never_discloses_credentials(self):
        class Result:
            returncode=1
            stdout=''
            stderr='private-password'
        with patch.object(audit.subprocess,'run',return_value=Result()):
            with self.assertRaisesRegex(ValueError,'denied') as exc:
                audit.check('postgresql://tester:private-password@localhost/test')
            self.assertNotIn('private-password',str(exc.exception))
