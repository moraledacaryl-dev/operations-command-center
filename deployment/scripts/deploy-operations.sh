#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

require_root

APP="operations-command-center"
SRC="/root/repos/${APP}"
BASE="/opt/${APP}"
ENV_FILE="/etc/hiddenoasis/operations.env"
RELEASE="${BASE}/releases/$(timestamp)"
CURRENT="${BASE}/current"

require_path "$SRC" "source repo"
require_env_file "$ENV_FILE"
require_path "${SRC}/backend/requirements.txt" "Operations backend requirements"
require_path "${SRC}/frontend/package.json" "Operations frontend package"

log "Preparing Operations release at ${RELEASE}"
mkdir -p "${BASE}/releases"
rsync -a --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.venv' \
  "${SRC}/" "${RELEASE}/"

log "Installing backend dependencies"
python3 -m venv "${RELEASE}/backend/.venv"
"${RELEASE}/backend/.venv/bin/pip" install --upgrade pip
"${RELEASE}/backend/.venv/bin/pip" install -r "${RELEASE}/backend/requirements.txt"

log "Compiling backend"
PYTHONPYCACHEPREFIX=/tmp/pycache-operations-deploy \
  "${RELEASE}/backend/.venv/bin/python" -m compileall "${RELEASE}/backend/app" "${RELEASE}/backend/tests"

log "Installing frontend dependencies"
if [ -f "${RELEASE}/frontend/package-lock.json" ]; then
  npm --prefix "${RELEASE}/frontend" ci
else
  npm --prefix "${RELEASE}/frontend" install
fi

log "Building frontend"
npm --prefix "${RELEASE}/frontend" run build

backup_path "$BASE" "operations-opt"
install_unit "${RELEASE}/deployment/systemd/operations-backend.service"
install_unit "${RELEASE}/deployment/systemd/operations-frontend.service"
activate_release "$RELEASE" "$CURRENT"

log "Restarting Operations services"
systemctl daemon-reload
systemctl enable operations-backend operations-frontend
systemctl restart operations-backend operations-frontend
systemctl is-active operations-backend operations-frontend

log "Operations deployed. Verify: curl -i http://127.0.0.1:8200/api/health"
