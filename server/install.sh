#!/bin/bash
# One-command install for Ubuntu 22.04 / 24.04.
# Does not create or print a private key.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash server/install.sh"
  exit 1
fi
SRC="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  apt-get update
  apt-get install -y ca-certificates curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
id sms >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin sms
install -d -o sms -g sms -m 700 /var/lib/sms /etc/sms /opt/sms
rm -rf /opt/sms/src /opt/sms/package.json /opt/sms/package-lock.json
cp -a "$SRC/package.json" "$SRC/src" /opt/sms/
if [[ -f "$SRC/package-lock.json" ]]; then cp -a "$SRC/package-lock.json" /opt/sms/; fi
chown -R sms:sms /opt/sms
sudo -u sms bash -lc 'cd /opt/sms && npm install --omit=dev'
install -m 644 "$SRC/sms-daemon.service" /etc/systemd/system/sms-daemon.service
if [[ ! -f /etc/sms/sms.env ]]; then
  cat > /etc/sms/sms.env << 'EOF'
SMS_STATE_DIR=/var/lib/sms
SMS_KEY_FILE=/etc/sms/key
SMS_PASSPHRASE_FILE=/etc/sms/passphrase
SMS_BIND=0.0.0.0
SMS_PORT=8787
SMS_SETUP_PORT=8788
SMS_DRY_RUN=1
SMS_RPC=https://solana-rpc.publicnode.com
SMS_REPO=vomidvari7-beep/solana-meme-sinper
EOF
  chown root:sms /etc/sms/sms.env
  chmod 640 /etc/sms/sms.env
fi
systemctl daemon-reload
systemctl enable sms-daemon
systemctl restart sms-daemon
echo
echo "Daemon installed. First start is dry-run until you set SMS_DRY_RUN=0."
echo "Create the key with either:"
echo "  1) ssh -L 8788:127.0.0.1:8788 user@vps  then open http://127.0.0.1:8788"
echo "  2) install -m 600 /dev/stdin /etc/sms/key  and a passphrase file /etc/sms/passphrase mode 600"
echo "The plaintext key file is deleted after it is encrypted. Never commit it."
