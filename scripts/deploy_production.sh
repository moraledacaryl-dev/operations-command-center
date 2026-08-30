#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT:-/root/repos/operations-command-center}"
APP_ROOT="${APP_ROOT:-/opt/operations-command-center}"
BACKEND_ENV="${BACKEND_ENV:-/etc/hiddenoasis/operations.env}"
BACKEND_SERVICE="${BACKEND_SERVICE:-operations-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-operations-frontend}"
PUBLIC_URL="${PUBLIC_URL:-https://operations.hiddenoasis.app}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/operations-command-center}"
EXPECTED_SHA="${1:-}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "ERROR | run this deployment as root" >&2
  exit 1
fi
if [[ ! -f "$BACKEND_ENV" ]]; then
  echo "ERROR | environment file missing: $BACKEND_ENV" >&2
  exit 1
fi

git -C "$REPO_ROOT" fetch --prune origin
CANDIDATE_SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"
if [[ -n "$EXPECTED_SHA" && "$CANDIDATE_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR | origin/main $CANDIDATE_SHA does not match expected $EXPECTED_SHA" >&2
  exit 1
fi

RELEASES_DIR="$APP_ROOT/releases"
RELEASE="$RELEASES_DIR/$CANDIDATE_SHA"
STAGING_RELEASE="$RELEASES_DIR/.staging-$CANDIDATE_SHA-$$"
CURRENT="$APP_ROOT/current"
PREVIOUS_RELEASE="$(readlink -f "$CURRENT" 2>/dev/null || true)"
ACTIVATED=false
BACKUP_FILE=""

cleanup_staging() {
  if [[ -d "$STAGING_RELEASE" ]]; then
    rm -rf -- "$STAGING_RELEASE"
  fi
}

rollback_application() {
  local exit_code=$?
  cleanup_staging
  if [[ "$ACTIVATED" == true && -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    echo "ERROR | post-activation check failed; restoring $PREVIOUS_RELEASE" >&2
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT"
    systemctl restart "$BACKEND_SERVICE" "$FRONTEND_SERVICE" || true
    echo "WARN | application release rolled back; database was not downgraded; backup: $BACKUP_FILE" >&2
  elif [[ "$ACTIVATED" == true ]]; then
    echo "ERROR | first release failed after activation; removing the active link" >&2
    rm -f -- "$CURRENT"
    systemctl stop "$BACKEND_SERVICE" "$FRONTEND_SERVICE" || true
    echo "WARN | services stopped; database was not downgraded; backup: $BACKUP_FILE" >&2
  fi
  exit "$exit_code"
}
trap rollback_application ERR

mkdir -p "$RELEASES_DIR" "$BACKUP_DIR"
getent group operations >/dev/null || groupadd --system operations
id operations >/dev/null 2>&1 || useradd --system --gid operations --home-dir /var/lib/operations-command-center --shell /usr/sbin/nologin operations
install -d -o operations -g operations -m 0750 /var/lib/operations-command-center/uploads /var/cache/operations-command-center/frontend
cleanup_staging
mkdir -p "$STAGING_RELEASE"
git -C "$REPO_ROOT" archive "$CANDIDATE_SHA" | tar -x -C "$STAGING_RELEASE"
echo "PASS | exported immutable candidate $CANDIDATE_SHA"

/usr/bin/python3 -m venv "$STAGING_RELEASE/backend/.venv"
"$STAGING_RELEASE/backend/.venv/bin/python" -m pip install -r "$STAGING_RELEASE/backend/requirements-test.txt"

TEST_DB="$(mktemp /tmp/operations-deploy-tests.XXXXXX.db)"
(
  cd "$STAGING_RELEASE/backend"
  env \
    -u SESSION_SECRET \
    -u INTEGRATION_API_KEY \
    -u BOOTSTRAP_OWNER_PASSWORD \
    -u BOOTSTRAP_OWNER_EMAIL \
    -u ALLOW_DEFAULT_ADMIN_BOOTSTRAP \
    ENVIRONMENT=local \
    DATABASE_URL="sqlite:///$TEST_DB" \
    PYTHONPATH=. \
    .venv/bin/python -m pytest tests -q
)
rm -f -- "$TEST_DB"
echo "PASS | backend tests"

(
  cd "$STAGING_RELEASE/frontend"
  npm ci
  npm run verify
  test -f .next/standalone/server.js
  test -d .next/standalone/.next/static
)
echo "PASS | frontend lint, typecheck, build and standalone package"

set -a
# shellcheck disable=SC1090
source "$BACKEND_ENV"
set +a

PG_DUMP_URL="$(
  "$STAGING_RELEASE/backend/.venv/bin/python" - <<'PY'
import os
from sqlalchemy.engine import make_url

url = make_url(os.environ.get("DATABASE_URL", ""))
if url.get_backend_name() != "postgresql":
    raise SystemExit("Production DATABASE_URL must use PostgreSQL")
print(url.set(drivername="postgresql").render_as_string(hide_password=False))
PY
)"
BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/database-$CANDIDATE_SHA-$BACKUP_STAMP.dump"
pg_dump --format=custom --no-owner --no-acl --dbname="$PG_DUMP_URL" > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
unset PG_DUMP_URL

UPLOAD_PATH="${UPLOAD_DIR:-/var/lib/operations-command-center/uploads}"
UPLOAD_BACKUP="$BACKUP_DIR/uploads-$CANDIDATE_SHA-$BACKUP_STAMP.tar.gz"
if [[ -d "$UPLOAD_PATH" ]]; then
  tar -C "$UPLOAD_PATH" -czf "$UPLOAD_BACKUP" .
else
  mkdir -p "$UPLOAD_PATH"
  tar -C "$UPLOAD_PATH" -czf "$UPLOAD_BACKUP" .
fi
sha256sum "$UPLOAD_BACKUP" > "$UPLOAD_BACKUP.sha256"
echo "PASS | paired database/upload backup checksummed"

(
  cd "$STAGING_RELEASE/backend"
  PYTHONPATH=. .venv/bin/alembic upgrade head
)
MIGRATION_HEAD="$(cd "$STAGING_RELEASE/backend" && PYTHONPATH=. .venv/bin/alembic heads | awk '{print $1}' | paste -sd, -)"

cat > "$STAGING_RELEASE/release.env" <<EOF
RELEASE_SHA=$CANDIDATE_SHA
EOF
cat > "$STAGING_RELEASE/release-manifest.json" <<EOF
{"release_sha":"$CANDIDATE_SHA","built_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","migration_head":"$MIGRATION_HEAD","database_backup":"$BACKUP_FILE","uploads_backup":"$UPLOAD_BACKUP","package_lock_sha256":"$(sha256sum "$STAGING_RELEASE/frontend/package-lock.json" | awk '{print $1}')","requirements_sha256":"$(sha256sum "$STAGING_RELEASE/backend/requirements.txt" | awk '{print $1}')"}
EOF
rm -rf -- "$STAGING_RELEASE/frontend/.next/standalone/.next/cache"
ln -s /var/cache/operations-command-center/frontend "$STAGING_RELEASE/frontend/.next/standalone/.next/cache"

if [[ -d "$RELEASE" ]]; then
  rm -rf -- "$STAGING_RELEASE"
  echo "PASS | immutable release already exists; reusing $RELEASE"
else
  mv "$STAGING_RELEASE" "$RELEASE"
fi
chown -R root:root "$RELEASE"
chmod -R a-w "$RELEASE"

install -m 0644 "$RELEASE/deployment/systemd/operations-backend.service" /etc/systemd/system/operations-backend.service
install -m 0644 "$RELEASE/deployment/systemd/operations-frontend.service" /etc/systemd/system/operations-frontend.service
ln -sfn "$RELEASE" "$CURRENT"
ACTIVATED=true
systemctl daemon-reload
systemctl enable "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
systemctl restart "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
systemctl is-active --quiet "$BACKEND_SERVICE"
systemctl is-active --quiet "$FRONTEND_SERVICE"

LIVE_JSON="$(curl -fsS "$PUBLIC_URL/api/livez")"
READY_JSON="$(curl -fsS "$PUBLIC_URL/api/readyz")"
"$RELEASE/backend/.venv/bin/python" - "$CANDIDATE_SHA" "$LIVE_JSON" "$READY_JSON" <<'PY'
import json
import sys

expected, live_raw, ready_raw = sys.argv[1:]
live = json.loads(live_raw)
ready = json.loads(ready_raw)
if live.get("release_sha") != expected or ready.get("release_sha") != expected:
    raise SystemExit(f"release SHA mismatch: expected={expected} live={live} ready={ready}")
if ready.get("ready") is not True:
    raise SystemExit(f"readiness failed: {ready}")
PY

HTML="$(curl -fsS "$PUBLIC_URL/login")"
ASSET_PATH="$(printf '%s' "$HTML" | grep -oE '/_next/static/[^" ]+\.(css|js)' | head -1)"
test -n "$ASSET_PATH"
curl -fsS -o /dev/null "$PUBLIC_URL$ASSET_PATH"

OPERATIONS_SMOKE_BASE="$PUBLIC_URL/api" \
OPERATIONS_PUBLIC_ORIGIN="$PUBLIC_URL" \
OPERATIONS_REQUIRE_LOGIN_SMOKE=true \
OPERATIONS_EXPECTED_SHA="$CANDIDATE_SHA" \
PYTHONPATH="$RELEASE/backend" \
"$RELEASE/backend/.venv/bin/python" "$RELEASE/backend/scripts/release_smoke.py"

ACTIVE_BACKEND_DIR="$(systemctl show "$BACKEND_SERVICE" --property=WorkingDirectory --value)"
ACTIVE_FRONTEND_DIR="$(systemctl show "$FRONTEND_SERVICE" --property=WorkingDirectory --value)"
[[ "$ACTIVE_BACKEND_DIR" == "$CURRENT/backend" ]]
[[ "$ACTIVE_FRONTEND_DIR" == "$CURRENT/frontend/.next/standalone" ]]

ACTIVATED=false
trap - ERR
echo "DEPLOYMENT GATE: PASS | $CANDIDATE_SHA | migration $MIGRATION_HEAD | backup $BACKUP_FILE"
