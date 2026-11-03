"""Private trainer account display must never leak into public artifacts."""
import json
import os
import stat

import pytest

from scripts.seed_training_demo import PEOPLE, ensure_private_trainer_guide


def roster():
    return {
        "synthetic": True,
        "accounts": [
            {
                "name": name,
                "role": role,
                "email": slug + "@training.invalid",
                "department": department,
                "password": f"fictional-{slug}-only",
            }
            for name, role, slug, department in PEOPLE
        ],
    }


def test_trainer_guide_is_private_readable_and_repeatable(tmp_path):
    private = tmp_path / "private" / "accounts"
    private.mkdir(parents=True, mode=0o700)
    original = private / "PRIVATE_training_accounts.json"
    original.write_text(json.dumps(roster()), encoding="utf-8")
    original.chmod(0o600)
    guide = ensure_private_trainer_guide(private)
    text = guide.read_text(encoding="utf-8")
    assert "TRAINER ONLY" in text
    assert "=== FRONT DESK ===" in text
    assert "=== HOUSEKEEPING ===" in text
    assert "Email:" in text and "Password:" in text
    for _, _, slug, _ in PEOPLE:
        assert slug + "@training.invalid" in text
        assert "fictional-" + slug + "-only" in text
    assert stat.S_IMODE(guide.stat().st_mode) == 0o600
    assert original.read_text(encoding="utf-8") == json.dumps(roster())

    before = guide.stat().st_mtime_ns
    assert ensure_private_trainer_guide(private) == guide
    assert guide.stat().st_mtime_ns == before
    assert not list(private.glob("*.tmp"))
    assert not list(private.glob(".*.tmp"))


def test_trainer_guide_rejects_untrusted_or_incomplete_account_data(tmp_path):
    private = tmp_path / "accounts"
    private.mkdir()
    source = private / "PRIVATE_training_accounts.json"
    assert not (private / "PRIVATE_TRAINER_ACCOUNTS.txt").exists()
    with pytest.raises(SystemExit, match="REFUSED"):
        ensure_private_trainer_guide(private)
    data = roster()
    data["synthetic"] = False
    source.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(SystemExit, match="REFUSED"):
        ensure_private_trainer_guide(private)
    data = roster()
    data["accounts"][0]["email"] = "owner@example.org"
    source.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(SystemExit, match="REFUSED"):
        ensure_private_trainer_guide(private)
    assert not (private / "PRIVATE_TRAINER_ACCOUNTS.txt").exists()


@pytest.mark.skipif(os.name == "nt", reason="POSIX symlink checks")
def test_trainer_guide_refuses_redirected_private_files(tmp_path):
    private = tmp_path / "accounts"
    private.mkdir()
    roster_file = private / "PRIVATE_training_accounts.json"
    roster_file.write_text(json.dumps(roster()), encoding="utf-8")
    redirect = private / "PRIVATE_TRAINER_ACCOUNTS.txt"
    outside = tmp_path / "outside.txt"
    outside.write_text("unchanged", encoding="utf-8")
    redirect.symlink_to(outside)
    with pytest.raises(SystemExit, match="symlink"):
        ensure_private_trainer_guide(private)
    assert outside.read_text(encoding="utf-8") == "unchanged"
