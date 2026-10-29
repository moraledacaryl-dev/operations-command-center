#!/usr/bin/env python3
"""Real Mac packaged-app smoke: synthetic migration, restart, proxy and scoped logins."""
from __future__ import annotations

import json
import sqlite3
from http.cookies import SimpleCookie
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def wait_ready(url: str, timeout: int = 100) -> dict:
    end = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                result = json.loads(response.read())
                if response.status == 200 and result.get("ready") is True:
                    return result
                last_error = result
        except (OSError, ValueError, urllib.error.HTTPError) as error:
            last_error = error
        time.sleep(1)
    raise RuntimeError(f"Training readiness timeout: {last_error}")


def login(base: str, email: str, password: str) -> dict:
    request = urllib.request.Request(
        base + "/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError(f"Demo login HTTP {response.status}")
        return json.load(response)



def login_with_cookie(base: str, email: str, password: str) -> tuple[dict, str]:
    """Exercise the actual HTTP-only local cookie session (not a browser mock)."""
    request = urllib.request.Request(
        base + "/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.load(response)
        cookies = SimpleCookie()
        cookies.load(response.headers.get("Set-Cookie") or "")
        token = cookies.get("operations_session")
        assert token is not None and token.value, "Local login did not issue its secure session cookie"
        assert "token" not in payload, "Session bearer leaked into browser response JSON"
        return payload, f"operations_session={token.value}"


def actual_api(base: str, path: str, cookie: str, data: dict | None = None) -> dict:
    headers = {"Cookie": cookie, "Origin": base, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        base + "/api" + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        assert 200 <= response.status < 300, f"{path}: HTTP {response.status}"
        return json.load(response)


def exercise_staff_read_only_investigations(base: str, accounts: dict) -> None:
    """Exercise all four reading drills against the real packaged local API.

    Uses randomly generated first-launch credentials for two ordinary staff
    accounts. No mocked routes and no business-record writes.
    """
    front = accounts["reception-am@training.invalid"]
    maintenance = accounts["technician@training.invalid"]
    front_user, front_cookie = login_with_cookie(base, front["email"], front["password"])
    maint_user, maint_cookie = login_with_cookie(base, maintenance["email"], maintenance["password"])
    front_id = next(int(item["id"]) for item in front_user["departments"]
                    if item["name"] == "Front Desk")
    maint_id = next(int(item["id"]) for item in maint_user["departments"]
                    if item["name"] == "Maintenance")

    examples = [
        ("tasks", "priority", front_id, front_cookie, {"To Do", "Doing", "Review", "Done"}),
        ("shift-notes", "urgency", front_id, front_cookie, {"New", "Seen", "Follow", "Done"}),
        ("guests", "urgency", front_id, front_cookie, {"Open", "Follow", "Done"}),
        ("fixes", "urgency", maint_id, maint_cookie, {"Open", "Working", "Done", "Verified"}),
    ]
    saved_examples = {}
    for resource, field, dept_id, cookie, valid_statuses in examples:
        rows = actual_api(base, f"/{resource}?department_id={dept_id}&active=true", cookie)
        assert isinstance(rows, list), f"{resource} must provide an accessible staff list"
        sample = next((row for row in rows if
                       isinstance(row.get("title"), str)
                       and row["title"].startswith("[TRAINING] ")
                       and int(row.get("department_id") or 0) == dept_id
                       and row.get("status") in valid_statuses
                       and row.get(field) in {"Low", "Normal", "High", "Urgent"}), None)
        assert sample is not None, f"{resource}: no fictional readable staff practice example"
        detail = actual_api(base, f"/{resource}/{sample['id']}", cookie)
        assert detail["id"] == sample["id"]
        assert detail["title"] == sample["title"]
        assert detail["status"] == sample["status"]
        assert detail[field] == sample[field]
        assert int(detail["department_id"]) == dept_id
        saved_examples[resource] = detail

    # Department isolation must also hold on direct record access, not merely
    # when an employee applies the correct filter in the training UI.
    for resource, record_id, cookie in (
        ("fixes", saved_examples["fixes"]["id"], front_cookie),
        ("guests", saved_examples["guests"]["id"], maint_cookie),
    ):
        try:
            actual_api(base, f"/{resource}/{record_id}", cookie)
        except urllib.error.HTTPError as error:
            assert error.code == 403, (resource, error.code)
        else:
            raise AssertionError(f"Cross-department staff read unexpectedly succeeded: {resource}")

    try:
        actual_api(base, f"/tasks?department_id={maint_id}", front_cookie)
    except urllib.error.HTTPError as error:
        assert error.code == 403, ("department list leak", error.code)
    else:
        raise AssertionError("Staff unexpectedly listed another department's training tasks")
    print("PASS: packaged real HTTP staff Task/Handover/Guest/Fix reads, saved status/urgency and cross-department 403")


def exercise_real_local_workflows(base: str, roster: dict) -> None:
    """Smoke the packaged backend with actual authenticated HTTP and SQLite."""
    accounts = {row["email"]: row for row in roster["accounts"]}
    manager = accounts["manager@training.invalid"]
    actor, manager_cookie = login_with_cookie(base, manager["email"], manager["password"])
    front = next(dept for dept in actor["departments"] if dept["name"] == "Front Desk")
    front_id = int(front["id"])
    exercise_staff_read_only_investigations(base, accounts)
    guest = actual_api(base, "/guests", manager_cookie, {
        "title": "TRAINING SMOKE Room 210 shower no hot water TRN-LINK-MACSMOKE",
        "department_id": front_id, "status": "Open",
        "issue_type": "Room", "urgency": "High",
        "note": "Shower cold. Maintenance inspection then Front Desk guest callback.",
    })
    guest_id = int(guest["id"])
    staff = accounts["reception-am@training.invalid"]
    _, staff_cookie = login_with_cookie(base, staff["email"], staff["password"])
    notices = actual_api(base, "/notifications?limit=100", staff_cookie)
    candidate = next((
        item for item in notices["items"]
        if item.get("kind") == "training_practice_read"
        and item.get("title", "").startswith("[TRAINING] Daily notice practice")
        and not item.get("read_at")
    ), None)
    assert candidate is not None, "Staff should see their own unread fictional training notice"
    before_unread = int(notices["unread_count"])
    read = actual_api(base, f"/notifications/{candidate['id']}/read", staff_cookie, {})
    assert read.get("read_at"), "Staff must be able to acknowledge their own notification"
    updated = actual_api(base, "/notifications?limit=100", staff_cookie)
    saved = next((row for row in updated["items"] if row["id"] == candidate["id"]), None)
    assert saved is not None and saved.get("read_at"), "Read status must persist in the packaged backend"
    assert int(updated["unread_count"]) == before_unread - 1, "Unread count must update"
    print("PASS: ordinary staff can read and acknowledge a persisted, personally scoped notice")
    try:
        actual_api(base, f"/workflow/guests/{guest_id}/create-fix", staff_cookie, {
            "department_id": front_id, "note": "Unauthorized fictional repair request",
        })
    except urllib.error.HTTPError as error:
        assert error.code == 403, f"Staff should be denied, got {error.code}"
    else:
        raise AssertionError("Staff unexpectedly created a protected Fix")

    result = actual_api(base, f"/workflow/guests/{guest_id}/create-fix", manager_cookie, {
        "department_id": front_id, "note": "Fictional shower inspection and repair",
    })
    fix_id = int(result["fix"]["id"])
    assert result["guest"]["status"] == "Follow"
    assert result["guest"]["linked_fix_id"] == fix_id
    assert result["fix"]["linked_guest_note_id"] == guest_id
    assert result["fix"]["department_id"] == front_id
    for action, expected in (("start", "Working"), ("done", "Done"),
                             ("verify", "Verified")):
        payload = {"note": "Fictional water supply and temperature verified"} if action == "verify" else {}
        fixed = actual_api(base, f"/workflow/fixes/{fix_id}/{action}", manager_cookie, payload)
        assert fixed["status"] == expected, (action, fixed)
    closed_guest = actual_api(base, f"/guests/{guest_id}", manager_cookie)
    assert closed_guest["status"] == "Done", "Real backend must close linked Guest on Fix verification"
    assert closed_guest["linked_fix_id"] == fix_id

    req = actual_api(base, "/requests", manager_cookie, {
        "title": "Training equipment request TRN-REQ-MACSMOKE",
        "department_id": front_id, "request_type": "Equipment",
        "urgency": "Urgent",
        "reason": "Necessary for service; budget cost PHP 12000, quotation pending.",
    })
    submitted = actual_api(base, f"/workflow/requests/{req['id']}/submit-approval", manager_cookie, {})
    approval = submitted["approval"]
    assert submitted["request"]["status"] == "Review"
    assert approval["status"] == "Pending"
    assert approval["source_type"] == "ops_need"
    assert approval["source_id"] == req["id"]
    assert approval["department_id"] == front_id
    print("PASS: packaged local HTTP, cookie session, staff 403, reciprocal Guest↔Fix, auto-close and linked Pending Approval")


def main() -> None:
    bundle = Path(sys.argv[1]).resolve()
    resources = bundle / "Contents" / "Resources"
    backend = resources / "backend" / "training-api" / "training-api"
    frontend = resources / "frontend" / "standalone"
    node = resources / "runtime" / "node"
    executable = bundle / "Contents" / "MacOS" / "HiddenOasisTraining"
    for path in (backend, frontend / "server.js", frontend / ".next" / "static", node, executable):
        assert path.exists(), f"Missing bundled executable or asset: {path}"

    with tempfile.TemporaryDirectory(prefix="hidden-oasis-mac-test-") as temp:
        home = Path(temp) / "home"
        home.mkdir()
        state = home / "Library" / "Application Support" / "HiddenOasis" / "OperationsTraining"
        for part in ("private", "data", "uploads"):
            (state / part).mkdir(parents=True)
        db = (state / "data" / "operations_training_demo_macdesktop.sqlite").resolve()
        env = {
            "HOME": str(home), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TMPDIR": "/tmp", "LANG": "en_US.UTF-8",
            "ENVIRONMENT": "local",
            "ALLOW_DEMO_SEED": "false",
            "ALLOW_DEFAULT_ADMIN_BOOTSTRAP": "false",
            "TRAINING_STATE_DIR": str(state),
            "DATABASE_URL": "sqlite:///" + str(db),
            "UPLOAD_DIR": str(state / "uploads"),
            "SESSION_SECRET": "ci-test-mac-native-training-session-secret-not-production-abcde-1234",
            "INTEGRATION_API_KEY": "ci-test-mac-native-training-key-not-production-abcde-1234",
            "ALLOWED_HOSTS": "127.0.0.1,localhost",
            "ALLOWED_ORIGINS": "http://127.0.0.1:3401",
            "FORCE_HTTPS": "false", "EXPOSE_API_DOCS": "false",
            "TRUST_PROXY_HEADERS": "false",
            "HOSTNAME": "127.0.0.1", "PORT": "3401", "NODE_ENV": "production",
            "NEXT_PUBLIC_TRAINING_MODE": "true", "NEXT_TELEMETRY_DISABLED": "1",
        }
        try:
            # Failure injection against the FROZEN packaged initializer, not
            # just a Python unit test: a cancelled first boot leaves a journal,
            # partial migration and private credentials that must be archived.
            (state / "data" / ".first_launch_pending").write_text(
                "HIDDEN_OASIS_FICTIONAL_TRAINING_FIRST_LAUNCH_V1\n",
                encoding="utf-8",
            )
            with sqlite3.connect(db) as interrupted:
                interrupted.execute("CREATE TABLE interrupted_migration (value TEXT)")
                interrupted.execute("INSERT INTO interrupted_migration VALUES ('keep me')")
            accounts_dir = state / "private" / "accounts"
            accounts_dir.mkdir(parents=True)
            (accounts_dir / "PRIVATE_training_accounts.json").write_text(
                '{"interrupted":true}', encoding="utf-8"
            )
            for i in range(2):
                subprocess.run([str(backend), "init"], env=env, cwd=backend.parent, check=True, timeout=80)
                if i == 0:
                    backups = list((state / "recovery").glob(
                        "*/data/operations_training_demo_macdesktop.sqlite"
                    ))
                    assert len(backups) == 1, "Packaged recovery must retain the prior SQLite file"
                    with sqlite3.connect(backups[0]) as interrupted:
                        assert interrupted.execute(
                            "SELECT value FROM interrupted_migration"
                        ).fetchone()[0] == "keep me"
                    assert list((state / "recovery").glob(
                        "*/private/accounts/PRIVATE_training_accounts.json"
                    )), "Private interrupted roster was not preserved"
                    assert not (state / "data" / ".first_launch_pending").exists()
                
                with sqlite3.connect(db) as conn:
                    count = conn.execute(
                        "SELECT COUNT(*) FROM notifications WHERE kind='training_practice_read'"
                    ).fetchone()[0]
                    assert count == 40, f"Each of the 20 fictional roles needs two visible notices: {count}"
                    if i == 0:
                        # Simulate an existing installed training DB with a
                        # missing sample. Initialization must repair it without
                        # resetting user data or credentials.
                        conn.execute(
                            "DELETE FROM notifications WHERE id=(SELECT MIN(id) FROM notifications WHERE kind='training_practice_read')"
                        )
                        conn.commit()
            roster = json.loads((state / "private" / "accounts" / "PRIVATE_training_accounts.json").read_text())
            assert len(roster["accounts"]) == 20
            guide = state / "private" / "accounts" / "PRIVATE_TRAINER_ACCOUNTS.txt"
            assert guide.is_file(), "Trainer's human-readable accounts guide was not generated"
            assert guide.stat().st_mode & 0o077 == 0, "Trainer guide must be private (0600)"
            guide_text = guide.read_text(encoding="utf-8")
            assert "TRAINER ONLY" in guide_text and "=== FRONT DESK ===" in guide_text
            for account in roster["accounts"]:
                assert account["email"] in guide_text
                assert account["password"] in guide_text
            assert db.is_file()

            with (Path(temp) / "api.log").open("w+") as alog, (Path(temp) / "ui.log").open("w+") as ulog:
                api = subprocess.Popen([str(backend), "serve"], env=env, cwd=backend.parent,
                                       stdout=alog, stderr=subprocess.STDOUT)
                ui = subprocess.Popen([str(node), "server.js"], env=env, cwd=frontend,
                                      stdout=ulog, stderr=subprocess.STDOUT)
                try:
                    wait_ready("http://127.0.0.1:8401/api/readyz")
                    wait_ready("http://127.0.0.1:3401/api/readyz")
                    with urllib.request.urlopen("http://127.0.0.1:3401/login", timeout=10) as response:
                        assert "TRAINING ONLY" in response.read().decode(), "Training-only banner missing"
                    for email, role in (
                        ("manager@training.invalid", "manager"),
                        ("reception-am@training.invalid", "staff"),
                    ):
                        account = next(row for row in roster["accounts"] if row["email"] == email)
                        result = login("http://127.0.0.1:3401", email, account["password"])
                        assert result["role"] == role, (email, result.get("role"))
                    exercise_real_local_workflows("http://127.0.0.1:3401", roster)
                    print("PASS: native Mac app bundle, synthetic SQLite + 20 demo accounts, real manager/staff logins")
                finally:
                    for p in (ui, api):
                        if p.poll() is None:
                            p.terminate()
                            try: p.wait(timeout=8)
                            except subprocess.TimeoutExpired: p.kill()
                    alog.flush()
                    ulog.flush()
        except Exception:
            for name in ("api.log", "ui.log"):
                logfile = Path(temp) / name
                if logfile.exists():
                    print("=== " + name + " ===", file=sys.stderr)
                    print(logfile.read_text(errors="replace")[-9000:], file=sys.stderr)
            raise


if __name__ == "__main__":
    main()
