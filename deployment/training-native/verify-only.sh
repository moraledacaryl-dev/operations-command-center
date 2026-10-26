#!/usr/bin/env bash
# Read-only post-install checks, never alters production or training data.
set -Eeuo pipefail
for unit in operations-training-backend operations-training-frontend; do
  systemctl is-active --quiet "$unit" || { echo "ERROR | $unit not active" >&2; exit 1; }
done
systemctl is-active --quiet operations-backend || { echo "ERROR | production API not active" >&2; exit 1; }
systemctl is-active --quiet operations-frontend || { echo "ERROR | production UI not active" >&2; exit 1; }

for port in 3401 8401; do
  ss -ltnH | awk '{print $4}' | grep -Fxq "127.0.0.1:$port" || {
    echo "ERROR | training port $port not bound to localhost" >&2; exit 1;
  }
done

READINESS_FILE="$(mktemp /tmp/ops-training-readiness.XXXXXX)"
trap 'rm -f "$READINESS_FILE"' EXIT
for attempt in $(seq 1 25); do
  if curl -fsS --max-time 4 http://127.0.0.1:8401/api/readyz -o "$READINESS_FILE" 2>/dev/null; then break; fi
  sleep 1
done
python3 - "$READINESS_FILE" <<'PY'
import json, sys
with open(sys.argv[1],encoding="utf-8") as stream:
    result=json.load(stream)
assert result.get("ready") is True, "Synthetic database or API not ready"
print("PASS | training backend DB/migration/storage readiness")
PY
curl -fsS --max-time 6 http://127.0.0.1:3401/login | grep -q 'TRAINING ONLY' || {
  echo "ERROR | training-only login label absent" >&2; exit 1;
}
curl -fsS --max-time 6 http://127.0.0.1:3401/api/readyz > /dev/null || {
  echo "ERROR | Next.js API proxy unavailable" >&2; exit 1;
}
python3 - <<'PY'
import json, os, urllib.request, sqlite3
from pathlib import Path
root=Path("/var/lib/hiddenoasis-training")
assert Path("/etc/hiddenoasis-training/training.env").stat().st_mode & 0o077 == 0
roster=root/"private/accounts/PRIVATE_training_accounts.json"
assert roster.is_file() and roster.stat().st_mode & 0o077 == 0
accounts=json.loads(roster.read_text(encoding="utf-8"))["accounts"]
assert len(accounts) == 20
db=root/"data/operations_training_demo_main.sqlite"
with sqlite3.connect(str(db)) as connection:
    assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 20
    assert connection.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] >= 50
print("PASS | 20 private synthetic identities and sample work records")
PY
echo "PASS | training services, API proxy, fictional login and production service health"
