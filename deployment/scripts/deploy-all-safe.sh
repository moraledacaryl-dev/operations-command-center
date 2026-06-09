#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_root

backup_nginx

log "Running conservative checks/backups for live Accounting and POS"
"${SCRIPT_DIR}/deploy-accounting.sh"
"${SCRIPT_DIR}/deploy-pos.sh"

log "Deploying not-yet-live apps"
"${SCRIPT_DIR}/deploy-operations.sh"
"${SCRIPT_DIR}/deploy-staff.sh"

log "All deploy scripts completed. Root launcher cutover is still a separate manual gate."
