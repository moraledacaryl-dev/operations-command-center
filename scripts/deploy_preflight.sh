#!/usr/bin/env bash
# Sourced by the guarded deployment. Keep FD 9 open for its full lifetime.
operations_deploy_lock() {
  local lock_path="$1" previous_umask
  previous_umask="$(umask)"
  umask 077
  exec 9>"$lock_path"
  umask "$previous_umask"
  # The Python child shares the open file description with this shell, so
  # its flock remains held by FD 9 after the child exits. No extra package.
  if ! /usr/bin/python3 - <<'PY'
import fcntl
import sys
try:
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(73)
PY
  then
    echo "ERROR | another deployment is running or the deployment lock is unavailable" >&2
    return 1
  fi
}

operations_deploy_disk_preflight() {
  /usr/bin/python3 - "$@" <<'PY'
import pathlib
import shutil
import sys

minimum = sys.argv[1]
if not minimum.isascii() or not minimum.isdecimal() or int(minimum) < 1:
    sys.exit('ERROR | DEPLOY_MIN_FREE_MB must be a positive integer')
required = int(minimum) * 1024 * 1024
try:
    for raw in sys.argv[2:]:
        path = pathlib.Path(raw).resolve()
        while not path.exists():
            path = path.parent
        available = shutil.disk_usage(path).free
        if available < required:
            sys.exit('ERROR | insufficient free disk space for deployment preflight')
except OSError:
    sys.exit('ERROR | cannot inspect deployment filesystem capacity')
print('PASS | deployment filesystems meet minimum free-space floor')
PY
}
