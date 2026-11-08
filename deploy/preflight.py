#!/usr/bin/env python3
"""Read-only Titan Central deployment gate. Never reads secrets or changes services.

Usage: python3 preflight.py --config deploy/staging.example.json --root /path/to/extract
Optional: --live /home/admin/apps (read-only filesystem checks)
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

APPS = ('supercharged','sorted','lms')
NEEDED = ('oidc_origin','central_origin','app_origins','callback_paths','logout_paths',
          'central_db_separate','logto_db_separate','supported_postgres',
          'app_adapter_implemented','real_logto_verified','migration_verified',
          'two_tenant_test_passed','global_logout_test_passed','rollback_test_passed')


def validate_origin(value: str) -> bool:
    if not isinstance(value,str): return False
    try:
        u=urlsplit(value)
        return u.scheme=='https' and bool(u.hostname) and u.netloc==u.hostname and not u.username and not u.password and not u.port and not u.path.rstrip('/') and not u.query and not u.fragment
    except ValueError:
        return False


def validate_route(route: str) -> bool:
    if not isinstance(route,str) or not route.startswith('/') or route.startswith('//') or len(route)>180: return False
    return not any(x in route for x in ('\\','?','#','..','%','//')) and all(32<ord(x)<127 for x in route)


def assess(config: dict, root: Path | None = None, live: Path | None = None) -> dict:
    issues=[]
    if not isinstance(config,dict): return {'ready':False,'issues':['invalid_configuration'],'checked':0}
    for k in NEEDED:
        if k not in config: issues.append('missing:'+k)
    for k in ('oidc_origin','central_origin'):
        if not validate_origin(config.get(k)): issues.append('invalid_origin:'+k)
    origins=config.get('app_origins')
    if not isinstance(origins,dict) or set(origins)!=set(APPS):
        issues.append('invalid_app_origins')
    else:
        if any(not validate_origin(v) for v in origins.values()): issues.append('invalid_app_origin')
        all_origins=list(origins.values())+[config.get('oidc_origin'),config.get('central_origin')]
        if len(set(all_origins))!=len(all_origins): issues.append('duplicate_origin')
    for key in ('callback_paths','logout_paths'):
        routes=config.get(key)
        if not isinstance(routes,dict) or set(routes)!=set(APPS) or not all(validate_route(v) for v in routes.values()):
            issues.append('invalid_routes:'+key)
    for key in NEEDED[5:]:
        flags=config.get(key)
        if key == 'app_adapter_implemented':
            ok = isinstance(flags,dict) and set(flags)==set(APPS) and all(v is True for v in flags.values())
        else:
            ok = flags is True
        if not ok:
            issues.append('unverified:'+key)
    if root is not None:
        for rel in ('apps/control-api/src/server.mjs','packages/control-plane/src/index.ts',
                    'migrations/0004_session_revocations_draft.sql'):
            if not (root/rel).is_file(): issues.append('missing_source:'+rel)
        manifest=root/'PASS15_RELEASE_MANIFEST.json'
        if not manifest.is_file(): issues.append('missing_pass14_manifest')
        else:
            try:
                data=json.loads(manifest.read_text())
                if data.get('pass')!=15: issues.append('unexpected_baseline')
            except (ValueError,OSError): issues.append('invalid_baseline_manifest')
    if live is not None:
        for app,dirname in (('supercharged','supercharged'),('sorted','sorted')):
            if not (live/dirname).is_dir(): issues.append('missing_live_app:'+app)
        # Lms presence only; its path may not yet be created.
        if not (live/'lms').is_dir(): issues.append('missing_live_app:lms')
    return {'ready':not issues, 'issues':sorted(set(issues)),'checked':len(NEEDED)}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',type=Path,required=True)
    p.add_argument('--root',type=Path)
    p.add_argument('--live',type=Path)
    a=p.parse_args()
    try:
        config=json.loads(a.config.read_text())
    except (OSError,ValueError):
        print(json.dumps({'ready':False,'issues':['unreadable_configuration']}));raise SystemExit(2)
    result=assess(config,a.root,a.live)
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result['ready'] else 1)


if __name__=='__main__':main()
