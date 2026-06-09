#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_root

APP="hidden-oasis-staff-payroll"
SRC="/root/repos/${APP}"
BASE="/opt/${APP}"
ENV_FILE="/etc/hiddenoasis/staff-payroll.env"
RELEASE="${BASE}/releases/$(timestamp)"
CURRENT="${BASE}/current"

require_path "$SRC" "source directory"
require_env_file "$ENV_FILE"
require_path "${SRC}/app.py" "Staff Streamlit app"
require_path "${SRC}/requirements.txt" "Staff requirements"

log "Preparing Staff/Payroll release at ${RELEASE}"
mkdir -p "${BASE}/releases"
rsync -a --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude '.venv' \
  --exclude 'data' \
  --exclude 'exports' \
  --exclude '*.sqlite' \
  --exclude '*.db' \
  --exclude '*.log' \
  "${SRC}/" "${RELEASE}/"

log "Installing Staff/Payroll dependencies"
python3 -m venv "${RELEASE}/.venv"
"${RELEASE}/.venv/bin/pip" install --upgrade pip
"${RELEASE}/.venv/bin/pip" install -r "${RELEASE}/requirements.txt"

log "Compiling Staff/Payroll"
PYTHONPYCACHEPREFIX=/tmp/pycache-staff-deploy \
  "${RELEASE}/.venv/bin/python" -m compileall "${RELEASE}/app.py" "${RELEASE}/core" "${RELEASE}/tests"

backup_path "$BASE" "staff-opt"
install_unit "/root/repos/operations-command-center/deployment/systemd/staff-payroll.service"
activate_release "$RELEASE" "$CURRENT"

log "Restarting Staff/Payroll service"
systemctl daemon-reload
systemctl enable staff-payroll
systemctl restart staff-payroll
systemctl is-active staff-payroll

log "Staff/Payroll deployed. Verify: curl -I http://127.0.0.1:8501"
