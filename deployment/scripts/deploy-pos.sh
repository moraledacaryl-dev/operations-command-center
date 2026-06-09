#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_root

SRC="/root/repos/pos-cloud-online"
LIVE="/opt/pos-cloud-online"

require_path "$SRC" "POS source repo"
require_env_file "/etc/hiddenoasis/pos-backend.env"
require_env_file "/etc/hiddenoasis/pos-frontend.env"

if grep -Rqs "https://hiddenoasis.app/api" \
  "$SRC/backend/app" "$SRC/frontend" "$SRC/.env.example" "$SRC/.env.production.example"; then
  echo "Legacy Accounting root URL still appears in active POS app/default files. Stop before deploying." >&2
  exit 1
fi

log "POS deployment is intentionally conservative because POS is already live."
log "This script verifies the source does not contain the old Accounting root URL, backs up live files, then exits before modifying live POS."
backup_path "$LIVE" "pos-opt"
echo "Manual gated step still required: build/test POS, run migrations, then copy with rsync and restart pos services."
