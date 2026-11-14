"""Checks that the recorded upstream Logto pin is exact and matches docs/UPSTREAM.md (issue #24)."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class LogtoPin(unittest.TestCase):
    def setUp(self):
        self.pin = json.loads((ROOT / 'deploy' / 'logto-upstream.pin.json').read_text())
        self.doc = (ROOT / 'docs' / 'UPSTREAM.md').read_text()

    def test_commit_is_full_sha(self):
        self.assertRegex(self.pin['commit_sha'], r'^[0-9a-f]{40}$')

    def test_tag_is_exact_release_not_floating(self):
        self.assertRegex(self.pin['release_tag'], r'^v\d+\.\d+\.\d+$')
        self.assertNotIn('latest', json.dumps(self.pin).lower())

    def test_matches_upstream_doc_table(self):
        self.assertIn(f"| Release tag | `{self.pin['release_tag']}` |", self.doc)
        self.assertIn(f"| Commit SHA (full) | `{self.pin['commit_sha']}` |", self.doc)
        self.assertIn(f"**{self.pin['core_version']}**", self.doc)

    def test_core_version_matches_tag(self):
        self.assertEqual(self.pin['release_tag'], 'v' + self.pin['core_version'])


if __name__ == '__main__':
    unittest.main()
