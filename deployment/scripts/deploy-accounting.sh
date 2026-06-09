#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_root

SRC="/root/repos/accounting-program-online"
LIVE="/opt/accounting-program-online"

require_path "$SRC" "Accounting source repo"
require_env_file "/etc/hiddenoasis/accounting-backend.env"
require_env_file "/etc/hiddenoasis/accounting-frontend.env"

log "Accounting deployment is intentionally conservative because Accounting is already live."
log "Run the app-specific tests/build from ${SRC}; only replace ${LIVE} after they pass."
log "This script backs up live files and exits before modifying them."
backup_path "$LIVE" "accounting-opt"
echo "Manual gated step still required: build/test Accounting, then copy with rsync and restart accounting services."
