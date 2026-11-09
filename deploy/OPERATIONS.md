# Titan Central deployment operations

This guide documents how to operate the checked-in systemd template and secret template. It does not mean a live server, Logto tenant, database, DNS, or application integration has been configured or verified. Complete the gates in [PASS15_DEPLOYMENT_RUNBOOK.md](../PASS15_DEPLOYMENT_RUNBOOK.md) before installing the service.

Use a dedicated service account and an isolated Central database. Do not install this service into Sorted, Supercharged, LMS, or another product's directory or database.

## Prepare a release

Use immutable release directories and keep the previous release available for rollback. Render a copy of [central.service](central.service) on the target host and replace every `__PLACEHOLDER__`:

- `__SERVICE_USER__` and `__SERVICE_GROUP__`: dedicated, unprivileged account with no interactive login.
- `__APP_DIR__`: release root. A stable symlink such as `/opt/titan-central/current` may point to the active immutable release.
- `__NODE_BIN__`: absolute path to the supported Node.js executable.

The service binds to loopback. Configure the host reverse proxy and TLS separately after validating the hostnames and callback registrations. Never expose the Node port directly to the public network.

## Store secrets

The environment template contains placeholders only. Keep the completed file outside the repository and release directories:

```sh
sudo install -d -o root -g root -m 0700 /etc/titan-central
sudo install -o root -g root -m 0600 deploy/env.example /etc/titan-central/central.env
sudoedit /etc/titan-central/central.env
sudo chown root:root /etc/titan-central/central.env
sudo chmod 0600 /etc/titan-central/central.env
```

Replace every `REPLACE_ME` value on the server. Use a restricted database role and distinct OIDC audiences. Do not put credentials in the unit file, shell arguments, logs, source control, ZIP archives, or support tickets. Do not copy a real environment file back into the repository.

## Install and operate the service

Install the rendered unit file as `/etc/systemd/system/titan-central.service`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now titan-central.service
sudo systemctl status titan-central.service
curl --fail http://127.0.0.1:3102/healthz
```

The health endpoint checks database connectivity. A healthy response is not a substitute for the authentication, tenant-isolation, and integration tests in the deployment gates.

```sh
sudo systemctl start titan-central.service
sudo systemctl stop titan-central.service
sudo systemctl restart titan-central.service
sudo journalctl -u titan-central.service --since today
```

The service handles SIGTERM and SIGINT by stopping HTTP acceptance and closing its PostgreSQL pool. systemd's stop timeout is finite; investigate shutdown failures rather than repeatedly force-killing the service.

## Roll back an application release

Keep release directories immutable and do not unpack a new build over the active directory. If the deployment uses the `current` symlink pattern described above, switch it atomically to the previous known-good release and restart:

```sh
sudo ln -sfn /path/to/previous-release /path/to/current.next
sudo mv -Tf /path/to/current.next /path/to/current
sudo systemctl restart titan-central.service
sudo systemctl status titan-central.service
```

Replace the example paths with the actual release paths on the server. Confirm the loopback health check and review the service journal. If a database migration was applied, follow its separately reviewed backup/restore or forward-repair plan; switching the application symlink does not roll back database changes.

Keep the previous release and its verified database backup until the new release has passed the agreed observation period. Do not remove product login routes or change other product services as part of a Central rollback.

## Preflight and remaining external work

Run the read-only preflight from the repository root with the actual non-secret deployment configuration. The checked-in staging example must remain blocked until evidence exists. A successful preflight does not prove that a real Logto deployment, application SSO flow, multi-tenant isolation, or rollback rehearsal has passed.

The host owner must separately confirm the service account, Node path, domain/TLS/proxy configuration, secrets provisioning, isolated PostgreSQL role, and backup/restore procedure. No remote host changes are made by this repository guide.

## Authentication overload and rate-limit operations

Before enabling browser rollout, confirm the public reverse proxy applies
IP-keyed `limit_req` and `limit_conn` (or equivalently tested Apache
enforcement) to `/v1/access/check`, product OIDC start/callback,
Central OIDC start/callback and company-selection POST. Confirm the
proxy rewrites forwarding headers from the actual client socket.

Run `python3 -I deploy/proxy/validate_templates.py` and test the real
proxy configuration (`nginx -t` or `apachectl -t`) before reload.
Load-test from an isolated test IP with synthetic requests only.
Expected rejection: HTTP 429; verify no OIDC token exchange or
membership query occurs for rejected requests and legitimate traffic
recovers after the concurrency permit is released. Check structured
`access_rate_limited` and `login_rate_limited` metrics without
logging token, subject, state or authorization code values.

Limits in Node are per-process; scaling workers requires the external
proxy limit. A global in-process cap is a backstop, not a replacement.
A reverse-proxy reload or service restart may reset rate windows.
