"""Signed staging backfill rehearsal: security boundary and rollback tests."""
import hashlib
import hmac
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import rehearse_signed_backfill as r

C='00000000-0000-4000-8000-000000000011'
L='00000000-0000-4000-8000-000000000001'
I='00000000-0000-4000-8000-000000000901'
KEY='a1'*32

def manifest():
    return {'company_id':C,'legacy_organisation_id':L,'logto_organisation_id':'logto-company-a',
      'identity_id':I,'logto_subject':'rehearsal-subject',
      'identity_status':'active','membership_role':'member'}

def approval(item,*,now=None):
    instant=int(time.time() if now is None else now)+300
    digest=r.digest(item)
    payload='titan:staging-backfill-rehearsal:v1:'+str(instant)+':'+digest
    signature=hmac.new(bytes.fromhex(KEY),payload.encode(),hashlib.sha256).hexdigest()
    return {'manifest_sha256':digest,'expires_at_unix':instant,'signature':signature}

class RehearsalTests(unittest.TestCase):
    def test_valid_approval_binds_exact_manifest_and_expiry(self):
        m=manifest()
        self.assertTrue(r.verify_approval(m,approval(m,now=1000),KEY,now=1000))
        modified=dict(m,membership_role='owner')
        with self.assertRaisesRegex(r.RehearsalError,'digest mismatch'):
            r.verify_approval(modified,approval(m,now=1000),KEY,now=1000)
    def test_expired_invalid_signature_or_wrong_secret_refused(self):
        m=manifest();a=approval(m,now=1000)
        with self.assertRaisesRegex(r.RehearsalError,'expired'):
            r.verify_approval(m,a,KEY,now=1400)
        with self.assertRaisesRegex(r.RehearsalError,'signature rejected'):
            r.verify_approval(m,a,'b2'*32,now=1000)
        with self.assertRaisesRegex(r.RehearsalError,'secret'):
            r.verify_approval(m,a,'bad',now=1000)
    def test_injected_or_unknown_manifest_fields_refused(self):
        for bad in (dict(manifest(),membership_role="member'); DROP TABLE titan.identities;--"),
                    dict(manifest(),unknown_field='yes'),
                    dict(manifest(),logto_subject='evil\nsubject')):
            with self.assertRaises(r.RehearsalError):
                r.validate_manifest(bad)
    def test_production_db_and_legacy_db_refused(self):
        for db in ('titan_central','titan_shared_production','postgres','titan_shared_ci_extra'):
            with self.assertRaisesRegex(r.RehearsalError,'staging'):
                r.staging_database('postgresql://tester@localhost:5432/'+db)
        self.assertEqual(r.staging_database('postgresql://tester@localhost/titan_shared_ci'),'titan_shared_ci')
    def test_script_uses_serializable_transaction_exact_mapping_and_rollback(self):
        sql=r.render(manifest())
        self.assertIn('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;',sql)
        self.assertIn("l.status='verified'",sql)
        self.assertIn("c.status='active'",sql)
        self.assertIn('pg_advisory_xact_lock',sql)
        self.assertIn('identity already exists',sql)
        self.assertIn('INSERT INTO titan.identities',sql)
        self.assertIn('INSERT INTO titan.company_memberships',sql)
        self.assertEqual(sql.count('ROLLBACK;'),1)
        self.assertNotIn('COMMIT;',sql)
        self.assertNotIn('ON CONFLICT',sql)
    def test_valid_staging_run_reports_zero_persistent_records(self):
        m=manifest()
        class Result:returncode=0;stdout='';stderr=''
        with patch.object(r.subprocess,'run',return_value=Result()) as proc:
            result=r.rehearse('postgresql://tester@localhost/titan_shared_ci',m,
               approval(m),KEY,env={'TITAN_BACKFILL_STAGING_ENABLED':'1'})
        self.assertEqual(result['status'],'rolled_back')
        self.assertEqual(result['records_persisted'],0)
        self.assertFalse(result['production_execution_permitted'])
        self.assertIn('ROLLBACK;',proc.call_args.kwargs['input'])
    def test_disabled_staging_does_not_connect(self):
        m=manifest()
        with patch.object(r.subprocess,'run') as proc:
            with self.assertRaisesRegex(r.RehearsalError,'disabled'):
                r.rehearse('postgresql://tester@localhost/titan_shared_ci',
                    m,approval(m),KEY,env={})
            proc.assert_not_called()
    def test_failed_sql_does_not_disclose_sensitive_server_error(self):
        m=manifest()
        class Result:returncode=3;stdout='';stderr='rehearsal-subject SUPERSECRET'
        with patch.object(r.subprocess,'run',return_value=Result()):
            with self.assertRaisesRegex(r.RehearsalError,'transaction rejected') as err:
                r.rehearse('postgresql://tester@localhost/titan_shared_ci',
                   m,approval(m),KEY,env={'TITAN_BACKFILL_STAGING_ENABLED':'1'})
            self.assertNotIn('SUPERSECRET',str(err.exception))
