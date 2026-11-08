"""Conflict-first, non-writing canonical backfill planner tests."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from plan_company_backfill import plan
from test_company_reconciliation import source,target

class BackfillPlanTests(unittest.TestCase):
    def test_existing_matching_company_identity_and_access_is_no_op(self):
        result=plan(source(),target())
        self.assertEqual(result['conflict_count'],0)
        self.assertEqual(result['candidate_counts'],{'identities':0,'memberships':0,'entitlements':0,'user_links':0})
        self.assertFalse(result['writes_permitted'])
        self.assertFalse(result['migration_authorised'])
        self.assertEqual(result['status'],'candidate_review_only')
        self.assertNotIn('person-a',str(result))
    def test_missing_existing_access_creates_candidates_not_dml(self):
        c=target()
        c['memberships']=[];c['entitlements']=[];c['links']=[]
        result=plan(source(),c)
        self.assertEqual(result['candidate_counts'],{
          'identities':0,'memberships':1,'entitlements':1,'user_links':1})
        self.assertEqual(result['conflict_count'],0)
        self.assertNotIn('INSERT',str(result))
    def test_missing_identity_does_not_guess_canonical_uuid(self):
        c=target()
        c['identities']=[]
        result=plan(source(),c)
        self.assertEqual(result['candidate_counts']['identities'],1)
        self.assertEqual(result['candidate_counts']['memberships'],0)
        self.assertEqual(result['candidate_counts']['user_links'],0)
        self.assertGreater(result['conflict_count'],0)
        self.assertEqual(result['status'],'blocked')
    def test_pending_mapping_blocks_and_cannot_create_company(self):
        c=target()
        c['mappings'][0]['status']='pending'
        result=plan(source(),c)
        self.assertEqual(result['conflicts']['unverified_mapping'],1)
        self.assertEqual(result['candidate_counts']['memberships'],0)
        self.assertFalse(result['new_company_creation_permitted'])
    def test_mismatched_logto_organisation_rejected(self):
        c=target()
        c['mappings'][0]['logto_organisation_id']='imposter'
        result=plan(source(),c)
        self.assertEqual(result['conflicts']['mapping_identity_conflict'],1)
    def test_conflicting_role_entitlement_and_user_mapping_detected(self):
        c=target()
        c['memberships'][0]['role']='admin'
        c['entitlements'][0]['features']=['different']
        c['links'][0]['local_user_id']='foreign-user'
        result=plan(source(),c)
        self.assertEqual(result['conflicts']['membership_conflict'],1)
        self.assertEqual(result['conflicts']['entitlement_conflict'],1)
        self.assertEqual(result['conflicts']['user_link_conflict'],1)
    def test_duplicate_source_membership_rejected(self):
        s=source();s['memberships'].append(s['memberships'][0].copy())
        result=plan(s,target())
        self.assertEqual(result['conflicts']['duplicate_source_membership'],1)
    def test_report_never_exposes_subject_or_company_id(self):
        c=target();c['mappings']=[]
        result=plan(source(),c)
        self.assertNotIn('person-a',str(result))
        self.assertNotIn('org-a',str(result))
        self.assertNotIn('00000000',str(result))
    def test_mismatched_logto_mapping_never_produces_access_candidates(self):
        c=target()
        c['mappings'][0]['logto_organisation_id']='imposter'
        c['memberships']=[];c['entitlements']=[];c['links']=[]
        result=plan(source(),c)
        self.assertEqual(result['conflicts']['mapping_identity_conflict'],1)
        self.assertEqual(result['candidate_counts']['memberships'],0)
        self.assertEqual(result['candidate_counts']['entitlements'],0)
        self.assertEqual(result['candidate_counts']['user_links'],0)
    def test_inactive_canonical_company_never_produces_access_candidates(self):
        c=target()
        c['companies'][0]['status']='suspended'
        c['memberships']=[];c['entitlements']=[];c['links']=[]
        result=plan(source(),c)
        self.assertEqual(result['conflicts']['inactive_mapped_company'],1)
        self.assertEqual(result['candidate_counts']['memberships'],0)
        self.assertEqual(result['candidate_counts']['entitlements'],0)
        self.assertEqual(result['candidate_counts']['user_links'],0)
    def test_unexpected_canonical_access_blocks_candidate_plan(self):
        c=target()
        c['memberships'].append({'company_id':c['companies'][0]['id'],'identity_id':'another-id','role':'owner','status':'active'})
        c['entitlements'].append({'company_id':c['companies'][0]['id'],'application_id':'lms','status':'active'})
        c['links'].append({'company_id':c['companies'][0]['id'],'identity_id':'another-id','application_id':'lms','status':'verified','local_user_id':'stranger'})
        result=plan(source(),c)
        self.assertEqual(result['conflicts']['unexpected_active_canonical_membership'],1)
        self.assertEqual(result['conflicts']['unexpected_active_canonical_entitlement'],1)
        self.assertEqual(result['conflicts']['unexpected_verified_canonical_user_link'],1)
        self.assertEqual(result['status'],'blocked')
