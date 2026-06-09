#!/usr/bin/env bash
set -euo pipefail

timestamp() {
  date +%Y%m%d-%H%M%S
}

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

require_root() {
  if [ "${EUID}" -ne 0 ]; then
    echo "Run as root on the Hetzner server." >&2
    exit 1
  fi
}

require_path() {
  local path="$1"
  local label="$2"
  if [ ! -e "$path" ]; then
    echo "Missing ${label}: ${path}" >&2
    exit 1
  fi
}

require_env_file() {
  local path="$1"
  require_path "$path" "env file"
  if grep -Eq 'replace-with|change-this|<server-secret>|placeholder' "$path"; then
    echo "Env file still contains placeholder values: ${path}" >&2
    exit 1
  fi
}

backup_path() {
  local path="$1"
  local label="$2"
  mkdir -p /root/deploy-backups
  if [ -e "$path" ]; then
    local out="/root/deploy-backups/${label}-$(timestamp).tar.gz"
    log "Backing up ${path} to ${out}"
    tar -czf "$out" "$path"
  else
    log "No existing ${path}; backup skipped"
  fi
}

backup_nginx() {
  mkdir -p /root/nginx-backups
  local ts
  ts="$(timestamp)"
  log "Backing up nginx config (${ts})"
  cp -a /etc/nginx/sites-available "/root/nginx-backups/sites-available-${ts}"
  cp -a /etc/nginx/sites-enabled "/root/nginx-backups/sites-enabled-${ts}"
  nginx -T >"/root/nginx-backups/nginx-full-${ts}.conf"
}

install_unit() {
  local src="$1"
  local dest="/etc/systemd/system/$(basename "$src")"
  require_path "$src" "systemd unit template"
  log "Installing systemd unit $(basename "$src")"
  cp "$src" "$dest"
}

activate_release() {
  local release_dir="$1"
  local current_link="$2"
  require_path "$release_dir" "validated release"
  ln -sfn "$release_dir" "$current_link"
}
