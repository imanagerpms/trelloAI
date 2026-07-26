#!/usr/bin/env bash
# Bootstrap una tantum su Scaleway (Ubuntu 24.04).
# Uso: curl -sL ... | bash   oppure  bash bootstrap.sh <PUBLIC_IP>
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/trelloai}"
PUBLIC_IP="${1:-${PUBLIC_IP:-}}"

if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(curl -4 -s ifconfig.me || true)"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  echo "Passa l'IP pubblico: bash bootstrap.sh 51.x.x.x"
  exit 1
fi

SSLP_HOST="$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"
PUBLIC_BASE_URL="https://${SSLP_HOST}"

echo "==> Host pubblico: $PUBLIC_BASE_URL"
echo "==> App dir: $APP_DIR"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node 22
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

# Caddy
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# pm2
npm install -g pm2

mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Caddyfile
cat >/etc/caddy/Caddyfile <<EOF
${SSLP_HOST} {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
EOF

systemctl enable caddy
systemctl restart caddy

# Env stub for PUBLIC_BASE_URL (secrets arrivano con ship --env)
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat >"$APP_DIR/.env" <<EOF
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
PUBLIC_HTTP_PORT=8787
OCTORATE_OAUTH_REDIRECT_URI=${PUBLIC_BASE_URL}/oauth/callback
OCTORATE_MCP_URL=https://mcp.octorate.com/mcp
EOF
else
  grep -q '^PUBLIC_BASE_URL=' "$APP_DIR/.env" || echo "PUBLIC_BASE_URL=${PUBLIC_BASE_URL}" >>"$APP_DIR/.env"
  grep -q '^OCTORATE_OAUTH_REDIRECT_URI=' "$APP_DIR/.env" || echo "OCTORATE_OAUTH_REDIRECT_URI=${PUBLIC_BASE_URL}/oauth/callback" >>"$APP_DIR/.env"
fi

echo ""
echo "Bootstrap OK."
echo "  PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
echo "  Redirect OAuth da aggiungere in Octorate:"
echo "    ${PUBLIC_BASE_URL}/oauth/callback"
echo "  Poi dal PC: npm run ship && npm run ship:env"
echo "  Login Octorate: ${PUBLIC_BASE_URL}/oauth/login"
