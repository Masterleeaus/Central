#!/usr/bin/env bash
# Real nginx parser check for a PRODUCT-host-only company selection route.
# Uses disposable local files and an isolated container; no public changes.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sed 's/__PRODUCT_PORT__/3200/g' \
  "$ROOT/deploy/proxy/nginx/product-selection.conf.template" > "$TMP/selection.conf"
cp "$ROOT/deploy/proxy/nginx/zones.conf" "$TMP/zones.conf"
cat > "$TMP/nginx.conf" <<'EOF'
worker_processes 1;
error_log /dev/stderr notice;
pid /tmp/nginx-product-selection.pid;
events { worker_connections 128; }
http {
    access_log off;
    include /etc/nginx/zones.conf;
    server {
        listen 8080;
        server_name product.local;
        include /etc/nginx/selection.conf;
    }
}
EOF
docker run --rm --network none \
  --mount "type=bind,src=$TMP/nginx.conf,dst=/etc/nginx/nginx.conf,readonly" \
  --mount "type=bind,src=$TMP/zones.conf,dst=/etc/nginx/zones.conf,readonly" \
  --mount "type=bind,src=$TMP/selection.conf,dst=/etc/nginx/selection.conf,readonly" \
  nginx:1.27-alpine nginx -t
echo "product-host nginx company selection template parsed successfully"
