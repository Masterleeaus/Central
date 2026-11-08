#!/usr/bin/env python3
"""Read-only Titan Central deployment gate. Never reads secrets or changes services.

Run from the repository root:
  python3 deploy/preflight.py --config deploy/staging.example.json --root .
Optional read-only checks:
  --upstream-root /path/to/logto-master
  --live /home/admin/apps
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

APPS = ('desk', 'field', 'academy')
EVIDENCE_FLAGS = (
    'central_db_separate',
    'logto_db_separate',
    'supported_postgres',
    'real_logto_verified',
    'migration_verified',
    'two_tenant_test_passed',
    'global_logout_test_passed',
    'rollback_test_passed',
)
NEEDED = (
    'oidc_origin', 'central_origin', 'app_origins', 'callback_paths', 'logout_paths',
    'live_app_directories',
    *EVIDENCE_FLAGS,
    'app_adapter_implemented',
)


def validate_origin(value: str) -> bool:
    if not isinstance(value, str):
        return False
    try:
        u = urlsplit(value)
        return (
            u.scheme == 'https'
            and bool(u.hostname)
            and u.netloc == u.hostname
            and not u.username
            and not u.password
            and not u.port
            and not u.path.rstrip('/')
            and not u.query
            and not u.fragment
        )
    except ValueError:
        return False


def validate_route(route: str) -> bool:
    if not isinstance(route, str) or not route.startswith('/') or route.startswith('//') or len(route) > 180:
        return False
    return not any(x in route for x in ('\\', '?', '#', '..', '%', '//')) and all(32 < ord(x) < 127 for x in route)


def valid_directory_name(value: object) -> bool:
    return (
        isinstance(value, str)
        and value not in ('.', '..')
        and re.fullmatch(r'[A-Za-z0-9._-]{1,80}', value) is not None
    )


def assess(
    config: dict,
    root: Path | None = None,
    live: Path | None = None,
    upstream_root: Path | None = None,
) -> dict:
    issues = []
    if not isinstance(config, dict):
        return {'ready': False, 'issues': ['invalid_configuration'], 'checked': 0}
    for key in NEEDED:
        if key not in config:
            issues.append('missing:' + key)

    for key in ('oidc_origin', 'central_origin'):
        if not validate_origin(config.get(key)):
            issues.append('invalid_origin:' + key)

    origins = config.get('app_origins')
    if not isinstance(origins, dict) or set(origins) != set(APPS):
        issues.append('invalid_app_origins')
    else:
        if any(not validate_origin(value) for value in origins.values()):
            issues.append('invalid_app_origin')
        all_origins = list(origins.values()) + [config.get('oidc_origin'), config.get('central_origin')]
        if len(set(all_origins)) != len(all_origins):
            issues.append('duplicate_origin')

    for key in ('callback_paths', 'logout_paths'):
        routes = config.get(key)
        if not isinstance(routes, dict) or set(routes) != set(APPS) or not all(validate_route(value) for value in routes.values()):
            issues.append('invalid_routes:' + key)

    directories = config.get('live_app_directories')
    if (
        not isinstance(directories, dict)
        or set(directories) != set(APPS)
        or not all(valid_directory_name(value) for value in directories.values())
    ):
        issues.append('invalid_live_app_directories')

    if not isinstance(config.get('app_adapter_implemented'), dict) or set(config['app_adapter_implemented']) != set(APPS):
        issues.append('invalid_app_adapter_implemented')
    elif any(config['app_adapter_implemented'].get(app) is not True for app in APPS):
        issues.append('unverified:app_adapter_implemented')

    for key in EVIDENCE_FLAGS:
        if config.get(key) is not True:
            issues.append('unverified:' + key)

    if root is not None:
        central_root = root / 'titan-central' if (root / 'titan-central').is_dir() else root
        required = (
            'apps/control-api/src/server.mjs',
            'packages/control-plane/src/index.ts',
            'migrations/0004_session_revocations_draft.sql',
        )
        for relative_path in required:
            if not (central_root / relative_path).is_file():
                issues.append('missing_source:' + relative_path)
        manifest = central_root / 'PASS14_RELEASE_MANIFEST.json'
        if not manifest.is_file():
            issues.append('missing_pass14_manifest')
        else:
            try:
                data = json.loads(manifest.read_text())
                if data.get('pass') != 14:
                    issues.append('unexpected_baseline')
            except (ValueError, OSError):
                issues.append('invalid_baseline_manifest')

    if upstream_root is not None and not (upstream_root / 'LICENSE').is_file():
        issues.append('missing_upstream_license')

    if live is not None:
        if not isinstance(directories, dict) or set(directories) != set(APPS) or not all(
            valid_directory_name(value) for value in directories.values()
        ):
            if 'invalid_live_app_directories' not in issues:
                issues.append('invalid_live_app_directories')
        else:
            for app in APPS:
                if not (live / directories[app]).is_dir():
                    issues.append('missing_live_app:' + app)

    return {'ready': not issues, 'issues': sorted(set(issues)), 'checked': len(NEEDED)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--upstream-root', type=Path)
    parser.add_argument('--live', type=Path)
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text())
    except (OSError, ValueError):
        print(json.dumps({'ready': False, 'issues': ['unreadable_configuration']}))
        raise SystemExit(2)
    result = assess(config, args.root, args.live, args.upstream_root)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['ready'] else 1)


if __name__ == '__main__':
    main()
