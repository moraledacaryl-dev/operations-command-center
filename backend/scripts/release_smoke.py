from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from app import models
from app.database import SessionLocal
from app.routers.api import UPLOAD_DIR, sign_token

BASE = os.getenv("OPERATIONS_SMOKE_BASE", "http://127.0.0.1:8200/api").rstrip("/")
PUBLIC_ORIGIN = os.getenv("OPERATIONS_PUBLIC_ORIGIN", "https://operations.hiddenoasis.app").rstrip("/")
REQUIRE_LOGIN = os.getenv("OPERATIONS_REQUIRE_LOGIN_SMOKE", "false").strip().lower() in {"1", "true", "yes"}
STAMP = str(int(time.time()))
PREFIX = f"DEPLOY-SMOKE-{STAMP}"


def request(method: str, path: str, *, bearer: str | None = None, body: bytes | dict | None = None, content_type: str | None = None, cookie: str | None = None):
    headers: dict[str, str] = {}
    data = body
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if cookie:
        headers["Cookie"] = cookie
        headers["Origin"] = PUBLIC_ORIGIN
        headers["Referer"] = f"{PUBLIC_ORIGIN}/"
    if isinstance(body, dict):
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type

    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read()
            ctype = response.headers.get("Content-Type", "")
            payload = json.loads(raw.decode()) if "application/json" in ctype and raw else raw
            return response.status, payload, response.headers
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode())
        except Exception:
            payload = raw
        return exc.code, payload, exc.headers


def multipart(filename: str, mime: str, data: bytes):
    boundary = "----OPERATIONS" + uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
        data,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return body, f"multipart/form-data; boundary={boundary}"


def expect(label: str, actual: int, wanted: int):
    if actual != wanted:
        raise RuntimeError(f"{label}: HTTP {actual}, expected {wanted}")
    print(f"PASS | {label}: HTTP {actual}")


def login_smoke():
    email = os.getenv("OPERATIONS_SMOKE_EMAIL", "").strip()
    password = os.getenv("OPERATIONS_SMOKE_PASSWORD", "")
    if not email or not password:
        if REQUIRE_LOGIN:
            raise RuntimeError("OPERATIONS_SMOKE_EMAIL/PASSWORD are required for credential login smoke")
        print("SKIP | credential login smoke credentials are not configured")
        return
    status, payload, _ = request("POST", "/auth/login", body={"email": email, "password": password})
    expect("credential login smoke", status, 200)
    if not isinstance(payload, dict) or not payload.get("token"):
        raise RuntimeError("credential login smoke did not return a token")


def main():
    task_id = None
    attachment_id = None
    stored_file: Path | None = None

    login_smoke()

    try:
        with SessionLocal() as db:
            owner = db.query(models.User).filter(models.User.role == "owner", models.User.is_active == True).first()
            if not owner:
                raise RuntimeError("No active Owner exists for release smoke")
            department_id = owner.department_id
            if not department_id:
                membership = db.query(models.UserDepartment).filter(models.UserDepartment.user_id == owner.id).first()
                department_id = membership.department_id if membership else None
            if not department_id:
                raise RuntimeError("Owner has no department for release smoke")
            now = int(time.time())
            bearer = sign_token({"sub": owner.id, "role": owner.role, "iat": now, "exp": now + 600})

        status, me, _ = request("GET", "/auth/me", bearer=bearer)
        expect("authenticated read smoke", status, 200)
        if not isinstance(me, dict) or me.get("role") != "owner":
            raise RuntimeError("authenticated read smoke did not return Owner")

        status, task, _ = request(
            "POST",
            "/tasks",
            bearer=bearer,
            body={
                "title": PREFIX,
                "department_id": department_id,
                "status": "To Do",
                "priority": "Low",
                "note": "Temporary production deployment smoke; safe to remove.",
            },
        )
        expect("temporary write smoke", status, 200)
        task_id = int(task["id"])

        status, task_read, _ = request("GET", f"/tasks/{task_id}", bearer=bearer)
        expect("temporary read-back smoke", status, 200)
        if task_read.get("title") != PREFIX:
            raise RuntimeError("temporary read-back smoke returned the wrong Task")

        pdf = b"%PDF-1.7\nOperations deployment smoke\n%%EOF\n"
        body, content_type = multipart("deployment-smoke.pdf", "application/pdf", pdf)
        status, attachment, _ = request(
            "POST",
            f"/tasks/{task_id}/attachments",
            bearer=bearer,
            body=body,
            content_type=content_type,
        )
        expect("authorized upload smoke", status, 200)
        attachment_id = int(attachment["id"])

        status, downloaded, _ = request("GET", f"/attachments/{attachment_id}/download", bearer=bearer)
        expect("authorized download smoke", status, 200)
        if downloaded != pdf:
            raise RuntimeError("downloaded deployment-smoke attachment differs from uploaded bytes")

        with SessionLocal() as db:
            row = db.get(models.Attachment, attachment_id)
            if row and row.file_url and row.file_url.startswith("storage:"):
                stored_file = Path(UPLOAD_DIR) / row.file_url.removeprefix("storage:")

        status, _, headers = request(
            "POST",
            "/auth/logout",
            cookie=f"operations_session={bearer}",
        )
        expect("cookie logout smoke", status, 200)
        set_cookie = headers.get("Set-Cookie", "")
        if "operations_session=" not in set_cookie:
            raise RuntimeError("logout smoke did not clear operations_session cookie")

        print("RELEASE APPLICATION SMOKE: PASS")

    finally:
        with SessionLocal() as db:
            if task_id:
                db.query(models.ActivityLog).filter(
                    models.ActivityLog.entity_type == "tasks",
                    models.ActivityLog.entity_id == task_id,
                ).delete(synchronize_session=False)
                db.query(models.Comment).filter(
                    models.Comment.parent_type == "tasks",
                    models.Comment.parent_id == task_id,
                ).delete(synchronize_session=False)
                db.query(models.Attachment).filter(
                    models.Attachment.parent_type == "tasks",
                    models.Attachment.parent_id == task_id,
                ).delete(synchronize_session=False)
                task = db.get(models.Task, task_id)
                if task:
                    db.delete(task)
            db.commit()
        if stored_file:
            stored_file.unlink(missing_ok=True)
        print("PASS | release smoke records/files cleaned up")


if __name__ == "__main__":
    main()
