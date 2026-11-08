"""Canonical shared company migration runner: complete path, drift and fail-closed checks."""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('migrate_shared', ROOT/'tools'/'migrate_shared.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


class MemoryClient:
    """Simulates only the canonical registry. Real SQL is exercised by CI PostgreSQL."""
    def __init__(self, preexisting=False, applied=None):
        self.preexisting=preexisting
        self.applied=dict(applied or {})
        self.scripts=[]

    def query_rows(self, sql):
        if "to_regclass('titan.schema_migrations')" in sql:
            return [['1' if self.applied else '0']]
        if "to_regclass('titan.identities')" in sql:
            return [['1' if self.preexisting else '0']]
        if 'FROM titan.schema_migrations' in sql:
            return [[key,val] for key,val in sorted(self.applied.values())]
        raise AssertionError('unexpected query: '+sql)

    def execute(self, script):
        self.scripts.append(script)
        for migration in shared.discover(shared.CANONICAL):
            if ("INSERT INTO titan.schema_migrations (migration_id, checksum_sha256) "
                "VALUES ('%04d_%s','%s')" % (migration.version,migration.name,migration.checksum)) in script:
                self.applied[migration.version]=(f'{migration.version:04d}_{migration.name}',migration.checksum)
                return
        raise AssertionError('migration record not embedded atomically')


class SharedMigrationTests(unittest.TestCase):
    def test_all_migrations_have_contiguous_order_and_one_transaction(self):
        files=shared.discover(shared.CANONICAL)
        shared.validate_chain(files)
        self.assertEqual([m.version for m in files],[1,2,3,4,5,6,7,8])
        for m in files:
            self.assertIn('BEGIN;',m.text)
            self.assertIn('COMMIT;',m.text)

    def test_first_install_uses_authoritative_canonical_registry(self):
        client=MemoryClient()
        self.assertEqual(shared.run(client,dry_run=True),[1,2,3,4,5,6,7,8])
        self.assertEqual(client.scripts,[])
        self.assertEqual(shared.run(client),[1,2,3,4,5,6,7,8])
        self.assertEqual(shared.run(client),[])
        self.assertEqual(len(client.scripts),8)
        for script in client.scripts:
            self.assertIn('pg_advisory_xact_lock',script)
            self.assertIn('INSERT INTO titan.schema_migrations',script)
            self.assertNotIn('INSERT INTO public.schema_migrations',script)

    def test_preexisting_legacy_schema_is_refused_without_mutation(self):
        client=MemoryClient(preexisting=True)
        with self.assertRaisesRegex(shared.SharedMigrationError,'legacy or unknown'):
            shared.run(client)
        self.assertEqual(client.scripts,[])

    def test_registry_checksum_or_name_drift_refused(self):
        files=shared.discover(shared.CANONICAL)
        client=MemoryClient(applied={1:('0001_shared_company_core','invalid')})
        with self.assertRaisesRegex(shared.SharedMigrationError,'drift'):
            shared.run(client)
        client=MemoryClient(applied={1:('0001_unknown',files[0].checksum)})
        with self.assertRaisesRegex(shared.SharedMigrationError,'drift'):
            shared.run(client)

    def test_unknown_version_and_out_of_order_registry_fail_closed(self):
        files=shared.discover(shared.CANONICAL)
        client=MemoryClient(applied={99:('0099_unknown','checksum')})
        with self.assertRaisesRegex(shared.SharedMigrationError,'no file'):
            shared.run(client)
        client=MemoryClient(applied={2:('0002_shared_company_rls',files[1].checksum)})
        with self.assertRaisesRegex(shared.SharedMigrationError,'out-of-order'):
            shared.run(client)

    def test_legacy_migration_path_cannot_be_selected(self):
        with self.assertRaisesRegex(shared.SharedMigrationError,'only canonical'):
            shared.run(MemoryClient(),ROOT/'migrations')
