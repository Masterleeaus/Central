#!/usr/bin/env bash
# Validate the REAL nginx parser in an isolated disposable container.
# No production host, public service, or operator credentials are touched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed 's/__CENTRAL_PORT__/3102/g' "$ROOT/deploy/proxy/nginx/locations.conf" > "$TMP/locations.conf"
cp "$ROOT/deploy/proxy/nginx/zones.conf" "$TMP/zones.conf"
cat > "$TMP/nginx.conf" <<'EOF'
worker_processes 1;
error_log /dev/stderr notice;
pid /tmp/nginx.pid;
events { worker_connections 128; }
http {
    access_log off;
    include /etc/nginx/titan-zones.conf;
    server {
        listen 8080;
        server_name localhost;
        include /etc/nginx/titan-locations.conf;
    }
}
EOF
docker run --rm --network none \
  --mount "type=bind,src=$TMP/nginx.conf,dst=/etc/nginx/nginx.conf,readonly" \
  --mount "type=bind,src=$TMP/zones.conf,dst=/etc/nginx/titan-zones.conf,readonly" \
  --mount "type=bind,src=$TMP/locations.conf,dst=/etc/nginx/titan-locations.conf,readonly" \
  nginx:1.27-alpine nginx -t
echo "nginx proxy templates passed real parser syntax check"
