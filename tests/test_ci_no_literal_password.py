"""Guard for issue #151: the CI database password must not be committed as a literal."""
import os
import re
import subprocess
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
# Built from parts so this file does not contain the value it checks for.
OLD_LITERAL = 'ci-only-' + 'throwaway'
SKIP_DIRS = {'.git', 'node_modules'}


def tracked_text_files():
    try:
        out = subprocess.run(['git', '-C', ROOT, 'ls-files'], capture_output=True, text=True, check=True).stdout
        paths = [p for p in out.splitlines() if p]
    except (OSError, subprocess.CalledProcessError):
        paths = []
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                paths.append(os.path.relpath(os.path.join(dirpath, name), ROOT))
    for rel in paths:
        if rel == os.path.relpath(__file__, ROOT):
            continue
        full = os.path.join(ROOT, rel)
        try:
            with open(full, encoding='utf-8') as fh:
                yield rel, fh.read()
        except (OSError, UnicodeDecodeError):
            continue


class NoLiteralCiPasswordTest(unittest.TestCase):
    def test_old_literal_is_absent_from_tree(self):
        hits = [rel for rel, text in tracked_text_files() if OLD_LITERAL in text]
        self.assertEqual(hits, [], 'CI password literal found in: ' + ', '.join(hits))

    def test_workflow_uses_run_scoped_password(self):
        with open(os.path.join(ROOT, '.github', 'workflows', 'ci.yml'), encoding='utf-8') as fh:
            workflow = fh.read()
        self.assertIn('CI_DB_PASSWORD:', workflow)
        self.assertIn('github.run_id', workflow)
        # Any password value written inline in a DSN or env block must be an expression, not a literal.
        inline = re.findall(r'postgres(?:ql)?://[^:\s"]+:([^@\s"$]+)@', workflow)
        self.assertEqual(inline, [], 'literal password in a connection string')


if __name__ == '__main__':
    unittest.main()
