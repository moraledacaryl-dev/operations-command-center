from __future__ import annotations

"""Production smoke: health and existing-account authentication only.

Business writes, uploads and logout/revocation are tested in disposable test
fixtures. Never create accounts/Tasks or delete audit history on deployment.
"""
import json
import os
import urllib.error
import urllib.request

BASE = os.getenv("OPERATIONS_SMOKE_BASE", "http://127.0.0.1:8200/api").rstrip("/")
PUBLIC_ORIGIN = os.getenv("OPERATIONS_PUBLIC_ORIGIN", "https://operations.hiddenoasis.app").rstrip("/")
REQUIRE_LOGIN = os.getenv("OPERATIONS_REQUIRE_LOGIN_SMOKE", "false").strip().lower() in {"1", "true", "yes"}
EXPECTED_SHA = os.getenv("OPERATIONS_EXPECTED_SHA", "").strip()


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


def expect(label: str, actual: int, wanted: int):
    if actual != wanted:
        raise RuntimeError(f"{label}: HTTP {actual}, expected {wanted}")
    print(f"PASS | {label}: HTTP {actual}")


def session_cookie(headers) -> str:
    set_cookie = headers.get("Set-Cookie", "")
    if not set_cookie or "operations_session=" not in set_cookie:
        raise RuntimeError("login did not set operations_session cookie")
    return set_cookie.split(";", 1)[0]


def login_smoke():
    email = os.getenv("OPERATIONS_SMOKE_EMAIL", "").strip()
    password = os.getenv("OPERATIONS_SMOKE_PASSWORD", "")
    if not email or not password:
        if REQUIRE_LOGIN:
            raise RuntimeError("OPERATIONS_SMOKE_EMAIL/PASSWORD are required for credential login smoke")
        print("SKIP | credential login smoke credentials are not configured")
        return

    status, payload, headers = request("POST", "/auth/login", body={"email": email, "password": password})
    expect("credential login smoke", status, 200)
    if not isinstance(payload, dict):
        raise RuntimeError("credential login smoke did not return an account payload")
    if payload.get("token"):
        raise RuntimeError("browser login unexpectedly exposed a bearer token")

    cookie = session_cookie(headers)
    if "HttpOnly" not in headers.get("Set-Cookie", ""):
        raise RuntimeError("credential login cookie is not HttpOnly")
    status, me, _ = request("GET", "/auth/me", cookie=cookie)
    expect("credential cookie session smoke", status, 200)
    if not isinstance(me, dict) or not me.get("id"):
        raise RuntimeError("credential cookie session did not return a user")
    print("PASS | browser credential stays in HttpOnly cookie; bearer absent from JSON")


def main():
    status, live, _ = request("GET", "/livez")
    expect("public liveness smoke", status, 200)
    if EXPECTED_SHA and live.get("release_sha") != EXPECTED_SHA:
        raise RuntimeError("Public liveness release SHA differs from expected release")

    status, ready, _ = request("GET", "/readyz")
    expect("public readiness smoke", status, 200)
    if ready.get("ready") is not True:
        raise RuntimeError("Public readiness did not confirm readiness")
    if EXPECTED_SHA and ready.get("release_sha") != EXPECTED_SHA:
        raise RuntimeError("Public readiness release SHA differs from expected release")

    login_smoke()
    print("RELEASE APPLICATION SMOKE: PASS | health and existing-account authentication; no business mutations")


if __name__ == "__main__":
    main()
