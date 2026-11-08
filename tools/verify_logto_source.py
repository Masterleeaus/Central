#!/usr/bin/env python3
"""Read-only, stdlib-only source baseline checker for user-supplied Logto archive."""
import sys,hashlib,json,zipfile
from pathlib import Path

def check(archive,expected_hash=None):
    archive=Path(archive)
    with archive.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    with zipfile.ZipFile(archive) as z:
        bad=z.testzip()
        names=set(z.namelist())
        required={'logto-master/LICENSE','logto-master/package.json','logto-master/packages/core/package.json','logto-master/pnpm-workspace.yaml'}
        missing=sorted(required-names)
        root=json.loads(z.read('logto-master/package.json')) if not missing else {}
        core=json.loads(z.read('logto-master/packages/core/package.json')) if not missing else {}
        return {'valid':bad is None and not missing and root.get('license')=='MPL-2.0' and core.get('license')=='MPL-2.0' and (expected_hash is None or expected_hash==digest), 'zip_integrity':bad is None,'missing':missing,'sha256':digest,'sha256_matches':expected_hash is None or digest==expected_hash,'core_version':core.get('version'),'entries':len(names)}

if __name__=='__main__':
    if len(sys.argv)<2: raise SystemExit('usage: python verify_logto_source.py logto-master.zip [expected_sha256]')
    res=check(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None)
    print(json.dumps(res,indent=2)); raise SystemExit(0 if res['valid'] else 1)
