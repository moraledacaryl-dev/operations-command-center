#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="${REPO_ROOT:-/root/repos/operations-command-center}"
BACKEND_ENV="${BACKEND_ENV:-/etc/hiddenoasis/operations-backend.env}"
BACKEND_SERVICE="${BACKEND_SERVICE:-operations-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-operations-frontend}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8200}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:3200}"
PUBLIC_URL="${PUBLIC_URL:-https://operations.hiddenoasis.app}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/operations-command-center}"
EXPECTED_SHA="${1:-}"

cd "$REPO_ROOT"
git fetch --prune origin
OLD_SHA="$(git rev-parse HEAD)"
git checkout main
git pull --ff-only origin main
CANDIDATE_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse origin/main)"

if [[ -n "$EXPECTED_SHA" && "$CANDIDATE_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR | candidate SHA $CANDIDATE_SHA does not match expected $EXPECTED_SHA" >&2
  exit 1
fi
if [[ "$CANDIDATE_SHA" != "$REMOTE_SHA" ]]; then
  echo "ERROR | local main does not match origin/main" >&2
  exit 1
fi

echo "PASS | candidate SHA $CANDIDATE_SHA"

if [[ ! -f "$BACKEND_ENV" ]]; then
  echo "ERROR | backend environment file missing: $BACKEND_ENV" >&2
  exit 1
fi
if [[ ! -x backend/.venv/bin/python ]]; then
  echo "ERROR | backend virtualenv missing: backend/.venv" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$BACKEND_ENV"
set +a

source backend/.venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m pip install -r backend/requirements-test.txt

(
  cd backend
  env PYTHONPATH=. python -m pytest tests -q
)

echo "PASS | backend pytest"

(
  cd frontend
  npm ci
  npm run lint
  npm run typecheck
  npm run build
  test -f .next/standalone/server.js
  test -d .next/standalone/.next/static
  if [[ -d public ]]; then test -d .next/standalone/public; fi
)

echo "PASS | frontend locked install, lint, typecheck, build, standalone package"

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/operations-pre-${CANDIDATE_SHA:0:12}-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
echo "PASS | PostgreSQL backup $BACKUP_FILE"

(
  cd backend
  PYTHONPATH=. alembic upgrade head
  CURRENT="$(PYTHONPATH=. alembic current)"
  HEADS="$(PYTHONPATH=. alembic heads)"
  echo "Alembic current: $CURRENT"
  echo "Alembic heads:   $HEADS"
)

echo "PASS | Alembic upgraded"

rollback_application() {
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    return
  fi
  echo "ERROR | deployment failed after candidate activation; attempting application rollback to $OLD_SHA" >&2
  cd "$REPO_ROOT"
  git reset --hard "$OLD_SHA" || true
  (
    cd frontend
    npm ci
    npm run build
  ) || true
  systemctl restart "$BACKEND_SERVICE" "$FRONTEND_SERVICE" || true
  echo "WARN | database migration is not automatically downgraded; backup is $BACKUP_FILE" >&2
  exit "$exit_code"
}
trap rollback_application ERR

systemctl restart "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
sleep 3
systemctl is-active --quiet "$BACKEND_SERVICE"
systemctl is-active --quiet "$FRONTEND_SERVICE"
echo "PASS | production services active"

curl -fsS "$BACKEND_URL/api/livez" >/tmp/operations-livez.json
curl -fsS "$BACKEND_URL/api/readyz" >/tmp/operations-readyz.json
python - <<'PY'
import json
for path in ("/tmp/operations-livez.json", "/tmp/operations-readyz.json"):
    with open(path) as handle:
        payload = json.load(handle)
    if path.endswith("readyz.json") and payload.get("ready") is not True:
        raise SystemExit(f"readiness failed: {payload}")
print("PASS | liveness and readiness")
PY

curl -fsS -o /dev/null "$FRONTEND_URL/"
curl -fsS -o /dev/null "$PUBLIC_URL/"
echo "PASS | local and public frontend"

HTML="$(curl -fsS "$PUBLIC_URL/tasks")"
ASSET_PATH="$(printf '%s' "$HTML" | grep -oE '/_next/static/[^" ]+\.(css|js)' | head -1)"
if [[ -z "$ASSET_PATH" ]]; then
  echo "ERROR | could not discover a hashed Next.js asset from /tasks" >&2
  exit 1
fi
curl -fsS -o /dev/null "$FRONTEND_URL$ASSET_PATH"
curl -fsS -o /dev/null "$PUBLIC_URL$ASSET_PATH"
echo "PASS | hashed Next.js asset served locally and publicly: $ASSET_PATH"

# Compatibility health remains checked while callers migrate to /livez and /readyz.
curl -fsS -o /dev/null "$BACKEND_URL/api/health"

git -C "$REPO_ROOT" diff --quiet -- . ':(exclude)frontend/next-env.d.ts' || {
  echo "WARN | repository has tracked-file changes after deployment" >&2
  git -C "$REPO_ROOT" status --short
}

trap - ERR
echo "DEPLOYMENT GATE: PASS | $CANDIDATE_SHA"
