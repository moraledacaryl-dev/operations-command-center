import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from . import integration_models  # noqa: F401 - register integration tables with SQLAlchemy
from .database import SessionLocal
from .http_protection import enforce_request_boundary, request_id
from .routers.api import router
from .routers.integrations_v2 import router as integrations_v2_router
from .security import load_security_settings, validate_security_settings
from .seed import backfill_local_user_passwords, ensure_bootstrap_owner, seed_if_empty


security = load_security_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Refuse to start with unsafe production secrets or network policy.
    validate_security_settings(security)

    # Schema changes are applied only through Alembic before the API starts.
    with SessionLocal() as db:
        seed_if_empty(db)
        ensure_bootstrap_owner(db)
        backfill_local_user_passwords(db)
    yield


app = FastAPI(
    title="Manager Operations Command Center",
    version="3.3.0",
    lifespan=lifespan,
    docs_url="/docs" if security.expose_api_docs else None,
    redoc_url="/redoc" if security.expose_api_docs else None,
    openapi_url="/openapi.json" if security.expose_api_docs else None,
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(security.allowed_hosts))
if security.force_https:
    app.add_middleware(HTTPSRedirectMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(security.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Integration-Api-Key", "X-Request-Id"],
    expose_headers=["Content-Disposition", "X-Request-Id"],
    max_age=600,
)


@app.middleware("http")
async def request_boundary(request: Request, call_next):
    correlation_id = request_id(request)
    blocked = await enforce_request_boundary(request)
    if blocked is not None:
        blocked.headers["X-Request-Id"] = correlation_id
        return blocked
    response = await call_next(request)
    response.headers["X-Request-Id"] = correlation_id
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
    if security.production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/auth"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(router)
app.include_router(integrations_v2_router)
app.mount("/uploads", StaticFiles(directory=os.getenv("UPLOAD_DIR", "./uploads")), name="uploads")
