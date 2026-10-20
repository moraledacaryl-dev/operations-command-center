"""Production uploaded-file backup safety and atomicity regression checks."""

from pathlib import Path
import os
import stat
import subprocess
import tarfile

REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER = REPO_ROOT / "scripts" / "backup_uploads.sh"


def test_private_upload_backup_contains_files_and_is_readable(tmp_path: Path):
    source = tmp_path / "source files"
    source.mkdir()
    (source / "receipt 01.txt").write_text("test upload contents", encoding="utf-8")
    backup_dir = tmp_path / "private backups"
    backup_dir.mkdir()
    destination = backup_dir / "uploads.tar.gz"

    subprocess.run(["bash", str(HELPER), str(source), str(destination)], check=True)

    assert stat.S_IMODE(destination.stat().st_mode) == 0o600
    with tarfile.open(destination, "r:gz") as archived:
        member = next(m for m in archived.getmembers() if m.name.endswith("receipt 01.txt"))
        assert archived.extractfile(member).read() == b"test upload contents"
    assert not list(backup_dir.glob("*.tmp.*"))


def test_missing_upload_directory_fails_without_overwriting_backup(tmp_path: Path):
    destination = tmp_path / "uploads.tar.gz"
    destination.write_bytes(b"earlier-valid-archive")
    result = subprocess.run(
        ["bash", str(HELPER), str(tmp_path / "missing"), str(destination)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "does not exist" in result.stderr
    assert destination.read_bytes() == b"earlier-valid-archive"
    assert not list(tmp_path.glob("*.tmp.*"))


def test_tar_failure_cleans_partial_archive_and_preserves_existing_backup(tmp_path: Path):
    source = tmp_path / "uploads"
    source.mkdir()
    (source / "note.txt").write_text("data", encoding="utf-8")
    destination = tmp_path / "uploads.tar.gz"
    destination.write_bytes(b"previous-backup")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_tar = fake_bin / "tar"
    fake_tar.write_text("#!/usr/bin/env bash\nexit 19\n", encoding="utf-8")
    fake_tar.chmod(0o755)
    env = os.environ.copy()
    env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

    result = subprocess.run(
        ["bash", str(HELPER), str(source), str(destination)],
        env=env,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert destination.read_bytes() == b"previous-backup"
    assert not list(tmp_path.glob("*.tmp.*"))
