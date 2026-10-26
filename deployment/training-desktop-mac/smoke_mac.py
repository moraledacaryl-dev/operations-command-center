#!/usr/bin/env python3
"""Real Mac packaged-app smoke: synthetic migration, restart, proxy and scoped logins."""
from __future__ import annotations

import json
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
            for i in range(2):
                subprocess.run([str(backend), "init"], env=env, cwd=backend.parent, check=True, timeout=80)
            roster = json.loads((state / "private" / "accounts" / "PRIVATE_training_accounts.json").read_text())
            assert len(roster["accounts"]) == 20
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
