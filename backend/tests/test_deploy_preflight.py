"""Exercise real process locking and read-only capacity rejection."""

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HELPER = REPO / "scripts/deploy_preflight.sh"


def shell(command, *args, **kwargs):
    return subprocess.run(["bash", "-c", 'source "$1"; ' + command, "audit", str(HELPER), *map(str, args)],
                          text=True, capture_output=True, **kwargs)


def test_second_deployment_cannot_enter_until_first_exits(tmp_path):
    lock = tmp_path / "deploy.lock"
    holder = subprocess.Popen([
        "bash", "-c", 'source "$1"; operations_deploy_lock "$2" || exit; printf "locked\\n"; read -r release',
        "audit", str(HELPER), str(lock),
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "locked"
        blocked = shell('operations_deploy_lock "$2" && printf "entered"', lock)
        assert blocked.returncode != 0
        assert "entered" not in blocked.stdout
        assert "another deployment" in blocked.stderr
        holder.communicate("release\n", timeout=5)
        admitted = shell('operations_deploy_lock "$2" && printf "entered"', lock)
        assert admitted.returncode == 0
        assert admitted.stdout == "entered"
    finally:
        if holder.poll() is None:
            holder.kill(); holder.communicate(timeout=5)


def test_lock_preserves_callers_umask_and_is_private(tmp_path):
    lock = tmp_path / "deploy.lock"
    result = shell('umask 0022; operations_deploy_lock "$2"; umask', lock)
    assert result.returncode == 0
    assert result.stdout.strip() == "0022"
    assert lock.stat().st_mode & 0o777 == 0o600


def test_disk_floor_passes_without_creating_target_directories(tmp_path):
    path = tmp_path / "new-app" / "releases"
    result = shell('operations_deploy_disk_preflight 1 "$2"', path)
    assert result.returncode == 0
    assert "PASS" in result.stdout
    assert not path.parent.exists()


def test_insufficient_disk_and_invalid_floor_fail_before_writing(tmp_path):
    path = tmp_path / "never-create"
    for floor in ["999999999999999", "0", "-1", "invalid"]:
        result = shell('operations_deploy_disk_preflight "$2" "$3"', floor, path)
        assert result.returncode != 0
        assert "ERROR" in result.stderr
        assert not path.exists()


def test_guarded_deploy_locks_and_checks_capacity_before_fetch_or_mutation():
    source = (REPO / "scripts/deploy_production.sh").read_text()
    lock = source.index('operations_deploy_lock "$DEPLOY_LOCK_FILE"')
    capacity = source.index('operations_deploy_disk_preflight "$DEPLOY_MIN_FREE_MB"')
    assert lock < capacity < source.index('git -C "$REPO_ROOT" fetch')
    assert capacity < source.index('mkdir -p "$RELEASES_DIR"')
