#!/usr/bin/env bash
# First installation only. Never touches a production repo, unit, DB, or nginx config.
set -Eeuo pipefail
umask 022

ARCHIVE="${1:-}"
ACK="${2:-}"
APP=/opt/hiddenoasis-training
STATE=/var/lib/hiddenoasis-training
CONFIG=/etc/hiddenoasis-training
CACHE=/var/cache/hiddenoasis-training

die() { printf 'REFUSED | %s\n' "$*" >&2; exit 1; }
[[ "${EUID:-$(id -u)}" == 0 ]] || die "Run as root through sudo"
[[ "$ACK" == "INSTALL_NEW_ISOLATED_TRAINING_ONLY" ]] || die "Explicit training-only acknowledgement required"
[[ -f "$ARCHIVE" && -s "$ARCHIVE" ]] || die "Provide a downloaded training-native tar.gz artifact"
for command in python3 tar ss systemctl df awk free node runuser curl useradd install; do
  command -v "$command" >/dev/null || die "Missing prerequisite $command"
done
[[ "$(uname -m)" == "x86_64" ]] || die "GitHub training wheelhouse supports x86_64 only"
[[ -x /usr/bin/node ]] || die "The frontend systemd unit expects /usr/bin/node; an NVM-only Node installation is not supported"
[[ "$(/usr/bin/node --version)" == v24.* ]] || die "The frontend systemd unit requires /usr/bin/node to be Node.js 24"
[[ "$(node --version)" == v24.* ]] || die "The SSH shell must have a validated Node.js 24 runtime"
[[ "$(python3 --version)" == Python\ 3.12.* ]] || die "Requires Ubuntu Python 3.12"
python3 -c 'import venv, ensurepip' >/dev/null 2>&1 || die "Python venv/ensurepip missing; install python3.12-venv separately before attempting training installation"

# First deployment must never overlap any existing listener or training deployment.
[[ ! -e "$APP/current" && ! -d "$STATE/data" && ! -e "$CONFIG/training.env" ]] || die "Existing training install detected; first-install script cannot overwrite it"
[[ ! -e /etc/systemd/system/operations-training-backend.service && ! -e /etc/systemd/system/operations-training-frontend.service ]] || die "Training unit already exists"
if ss -ltnH | awk '{print $4}' | grep -Eq ':(3401|8401)$'; then
  die "Training port 3401 or 8401 is already occupied"
fi
systemctl is-active --quiet operations-backend || die "Production Operations backend not active"
systemctl is-active --quiet operations-frontend || die "Production Operations frontend not active"

DISK_KB="$(df -Pk / | awk 'NR == 2 {print $4}')"
MEM_KB="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
[[ "$DISK_KB" =~ ^[0-9]+$ && "$DISK_KB" -gt 10485760 ]] || die "Need more than 10 GiB of free disk before installing"
[[ "$MEM_KB" =~ ^[0-9]+$ && "$MEM_KB" -gt 1179648 ]] || die "Need more than 1.125 GiB of available memory before installing"
echo "PASS | resources, reserved ports, and production service checks"

[[ ! -e "$APP" ]] || die "Installation root already exists"
install -d -m 0755 "$APP"
STAGE="$APP/.unpacked-$$"
install -d -m 0755 "$STAGE"

# Python 3.12 safe extraction explicitly rejects absolute paths and escaping links.
python3 - "$ARCHIVE" "$STAGE" <<'PY'
import sys, tarfile
from pathlib import Path
archive, stage = sys.argv[1:]
with tarfile.open(archive, "r:gz") as tar:
    tar.extractall(stage, filter="data")
    if len(tar.getmembers()) < 15:
        raise SystemExit("REFUSED | incomplete training release archive")
PY

python3 "$STAGE/deployment/training-native/check_release.py" --directory "$STAGE"
SHA="$(cat "$STAGE/commit.sha")"
RELEASE="$APP/releases/$SHA"
[[ ! -e "$RELEASE" ]] || die "Release already installed"
install -d -m 0755 "$APP/releases"

# Use offline pre-built Python wheels, not a live production-server network build.
python3 -m venv "$STAGE/backend/.venv"
"$STAGE/backend/.venv/bin/python" -m pip install --no-index --find-links "$STAGE/wheelhouse" -r "$STAGE/backend/requirements.txt"
"$STAGE/backend/.venv/bin/python" -m pip check

# Keep Next.js runtime cache writable without modifying the immutable code bundle.
install -d -m 0755 "$CACHE"
install -d -m 0750 "$CACHE/frontend"
rm -rf "$STAGE/frontend/standalone/.next/cache"
ln -s "$CACHE/frontend" "$STAGE/frontend/standalone/.next/cache"
mv "$STAGE" "$RELEASE"
chmod -R a+rX "$RELEASE"
ln -s "$RELEASE" "$APP/current"

# Distinct local OS identity is not used by any resort production service.
if ! id operations-training >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$STATE" --shell /usr/sbin/nologin operations-training
fi
install -d -o operations-training -g operations-training -m 0700 "$STATE" "$STATE/data" "$STATE/uploads" "$STATE/private"
chown operations-training:operations-training "$CACHE/frontend"
chmod 0700 "$CACHE/frontend"

# Secrets are unique to the training environment and never written to stdout.
install -d -m 0700 "$CONFIG"
python3 - "$CONFIG/training.env" "$SHA" <<'PY'
import os, secrets, sys
target, sha = sys.argv[1:]
with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as fp:
    settings = {
        "ENVIRONMENT":"local",
        "ALLOW_DEMO_SEED":"false",
        "ALLOW_DEFAULT_ADMIN_BOOTSTRAP":"false",
        "DATABASE_URL":"sqlite:////var/lib/hiddenoasis-training/data/operations_training_demo_main.sqlite",
        "UPLOAD_DIR":"/var/lib/hiddenoasis-training/uploads",
        "SESSION_SECRET":secrets.token_urlsafe(48),
        "INTEGRATION_API_KEY":secrets.token_urlsafe(48),
        "ALLOWED_ORIGINS":"http://127.0.0.1:3401,http://localhost:3401",
        "ALLOWED_HOSTS":"127.0.0.1,localhost",
        "FORCE_HTTPS":"false",
        "EXPOSE_API_DOCS":"false",
        "TRUST_PROXY_HEADERS":"false",
        "RELEASE_SHA":sha,
    }
    for key,value in settings.items():
        fp.write(f'{key}={value}\n')
PY

# Source training credentials in root's shell; never copy production environment.
set -a
# shellcheck disable=SC1091
source "$CONFIG/training.env"
set +a
[[ "$DATABASE_URL" == sqlite:////var/lib/hiddenoasis-training/data/operations_training_demo_main.sqlite ]] || die "Training DB misconfigured"
[[ ! -e "$STATE/data/operations_training_demo_main.sqlite" ]] || die "Training DB already present"
(
  cd "$RELEASE/backend"
  runuser -u operations-training -- "$RELEASE/backend/.venv/bin/python" -m alembic upgrade head
  runuser -u operations-training -- "$RELEASE/backend/.venv/bin/python" scripts/seed_training_demo.py \
    --confirm ISOLATED_TRAINING_DATABASE_ONLY --private-output "$STATE/private/accounts"
)
test -s "$STATE/private/accounts/PRIVATE_training_accounts.json" || die "Fictional user roster missing"

# The only units installed are new, dedicated training services.
install -m 0644 "$RELEASE/deployment/training-native/operations-training-backend.service" /etc/systemd/system/operations-training-backend.service
install -m 0644 "$RELEASE/deployment/training-native/operations-training-frontend.service" /etc/systemd/system/operations-training-frontend.service
systemctl daemon-reload
systemctl enable --now operations-training-backend.service
systemctl enable --now operations-training-frontend.service

bash "$RELEASE/deployment/training-native/verify-only.sh"
echo "TRAINING GATE: PASS | $SHA | private-only ports 3401 and 8401"
echo "All production service units and nginx configuration remain untouched."
