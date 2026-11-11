"""Non-mutating canonical cutover preflight must never authorise writes."""
import importlib.util
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cutover',ROOT/'tools/plan_company_cutover.py')
cutover=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)

def report(**changes):
    data={'schema':'titan.company-reconciliation.v1','read_only':True,
          'migration_authorised':False,'snapshots_atomic_across_databases':False,
          'snapshots_consistent_within_each_database':True,'blocker_count':0,
          'blockers':{},'row_counts':{'legacy':{'companies':1},'canonical':{'companies':1}}}
    data.update(changes)
    return data

class CutoverTests(unittest.TestCase):
    def test_perfect_reconciliation_without_approvals_is_blocked(self):
        result=cutover.generate(report())
        self.assertEqual(result['status'],'blocked')
        self.assertFalse(result['migration_authorised'])
        self.assertFalse(result['writes_permitted'])
        self.assertEqual(len(result['missing_gates']),len(cutover.CHECKS))
    def test_expiry_or_role_mismatch_blocks_even_when_evidence_complete(self):
        result=cutover.generate(report(blocker_count=1,blockers={'entitlement_expiry_mismatch':1}),
                               {k:True for k in cutover.CHECKS})
        self.assertEqual(result['status'],'blocked')
        self.assertEqual(result['missing_gates'],[])
        self.assertFalse(result['writes_permitted'])
    def test_all_evidence_only_marks_ready_for_separate_review(self):
        result=cutover.generate(report(),{k:True for k in cutover.CHECKS})
        self.assertEqual(result['status'],'ready_for_separate_human_review')
        self.assertFalse(result['migration_authorised'])
        self.assertFalse(result['writes_permitted'])
    def test_missing_per_database_snapshot_consistency_blocks(self):
        result=cutover.generate(report(snapshots_consistent_within_each_database=False),
                                {k:True for k in cutover.CHECKS})
        self.assertEqual(result['status'],'blocked')
    def test_malformed_report_totals_and_safety_claims_fail_closed(self):
        for item in [
            report(blocker_count=1,blockers={}),
            report(migration_authorised=True),
            report(snapshots_atomic_across_databases=True),
            report(blocker_count=True),
            report(schema='unknown')
        ]:
            with self.assertRaises(ValueError):cutover.generate(item)
    def test_unrecognised_or_false_evidence_cannot_bypass_gates(self):
        with self.assertRaises(ValueError):
            cutover.generate(report(),{'production_change_approved':'true'})
        with self.assertRaises(ValueError):
            cutover.generate(report(),{'unknown_approval':True})
