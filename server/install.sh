#!/bin/bash
# One-command install for Ubuntu 22.04 / 24.04.
# The private key is never created or printed here.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: curl -fsSL https://raw.githubusercontent.com/vomidvari7-beep/solana-meme-sinper/main/server/install.sh | sudo bash"
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https git

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" && -f "$(dirname "${BASH_SOURCE[0]}")/src/index.js" ]]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  rm -rf /tmp/sms-src
  git clone --depth 1 https://github.com/vomidvari7-beep/solana-meme-sinper.git /tmp/sms-src
  SRC=/tmp/sms-src/server
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update
  apt-get install -y caddy
fi

id sms >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin sms
install -d -o sms -g sms -m 700 /var/lib/sms /etc/sms /opt/sms
rm -rf /opt/sms/src /opt/sms/package.json /opt/sms/package-lock.json
cp -a "$SRC/package.json" "$SRC/src" /opt/sms/
if [[ -f "$SRC/package-lock.json" ]]; then cp -a "$SRC/package-lock.json" /opt/sms/; fi
chown -R sms:sms /opt/sms
sudo -u sms bash -lc 'cd /opt/sms && npm install --omit=dev'
install -m 644 "$SRC/sms-daemon.service" /etc/systemd/system/sms-daemon.service

touch /etc/sms/sms.env
chmod 640 /etc/sms/sms.env
chown root:sms /etc/sms/sms.env
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" /etc/sms/sms.env; then
    sed -i "s|^${key}=.*|${key}=${val}|" /etc/sms/sms.env
  else
    echo "${key}=${val}" >> /etc/sms/sms.env
  fi
}
set_env SMS_STATE_DIR /var/lib/sms
set_env SMS_KEY_FILE /etc/sms/key
set_env SMS_PASSPHRASE_FILE /etc/sms/passphrase
set_env SMS_BIND 127.0.0.1
set_env SMS_PORT 8787
set_env SMS_SETUP_PORT 8788
grep -q '^SMS_DRY_RUN=' /etc/sms/sms.env || set_env SMS_DRY_RUN 1
grep -q '^SMS_RPC=' /etc/sms/sms.env || set_env SMS_RPC https://solana-rpc.publicnode.com
grep -q '^SMS_REPO=' /etc/sms/sms.env || set_env SMS_REPO vomidvari7-beep/solana-meme-sinper

if [[ ! -s /var/lib/sms/api.token ]]; then
  openssl rand -hex 24 > /var/lib/sms/api.token
fi
chown sms:sms /var/lib/sms/api.token
chmod 600 /var/lib/sms/api.token
TOKEN="$(tr -d '[:space:]' < /var/lib/sms/api.token)"

IP="$(curl -4fsS --max-time 8 https://api.ipify.org || true)"
if [[ ! "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  IP="$(hostname -I | awk '{print $1}')"
fi
DOMAIN="${SMS_DOMAIN:-}"
if [[ -z "$DOMAIN" && -f /etc/sms/domain ]]; then DOMAIN="$(head -1 /etc/sms/domain | tr -d '[:space:]')"; fi
if [[ -n "$DOMAIN" ]]; then HOST="$DOMAIN"; else HOST="${IP//./-}.sslip.io"; fi
printf '%s\n' "$HOST" > /etc/sms/host
chmod 644 /etc/sms/host

if [[ -f /var/lib/sms/key.enc ]]; then
  printf '%s\n' '1' > /var/lib/sms/setup.done
  rm -f /var/lib/sms/setup.json
else
  CODE="$(openssl rand -hex 8)"
  EXP="$(($(date +%s) + 1800))"
  printf '{"code":"%s","exp":%s,"fails":0,"lockedUntil":0,"hits":[]}\n' "$CODE" "$EXP" > /var/lib/sms/setup.json
  chown sms:sms /var/lib/sms/setup.json
  chmod 600 /var/lib/sms/setup.json
  rm -f /var/lib/sms/setup.done
fi

cat > /etc/caddy/Caddyfile << EOF
${HOST} {
  encode gzip
  @setup path /setup /setup/
  handle @setup {
    reverse_proxy 127.0.0.1:8788
  }
  @api path /api/*
  handle @api {
    reverse_proxy 127.0.0.1:8787
  }
  handle {
    respond "not found" 404
  }
}
EOF
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy
systemctl daemon-reload
systemctl enable sms-daemon
systemctl restart sms-daemon

echo
echo "HTTPS  https://${HOST}"
echo "TOKEN  ${TOKEN}"
if [[ -f /var/lib/sms/setup.json ]]; then
  echo "SETUP  https://${HOST}/setup#${CODE}"
  echo "The setup link works once, for 30 minutes. It closes forever after the key is saved."
else
  echo "SETUP  already completed"
fi
echo "First start is dry-run. Set SMS_DRY_RUN=0 in /etc/sms/sms.env when you want live swaps."
echo "Open ports 80 and 443 on the VPS firewall so the certificate can be issued."
