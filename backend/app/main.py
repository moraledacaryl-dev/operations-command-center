import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from . import integration_models  # noqa: F401 - register integration tables with SQLAlchemy
from .api_read_boundary import ApiReadBoundaryMiddleware
from .authorization_freshness import AuthorizationFreshnessMiddleware
from .csrf_protection import CsrfProtectionMiddleware
from .database import SessionLocal
from .decision_boundary import DecisionBoundaryMiddleware
from .http_protection import enforce_request_boundary, request_id
from .identity_boundary import IdentityBoundaryMiddleware
from .internal_read_boundary import InternalReadBoundaryMiddleware
from .role_boundary import RoleBoundaryMiddleware
from .routers.api import router
from .routers.authorization_hotfix import router as authorization_hotfix_router
from .routers.integrations_v2 import router as integrations_v2_router
from .routers.my_work import router as my_work_router
from .routers.review import router as review_router
from .security import load_security_settings, validate_security_settings
from .security_audit import SecurityAuditMiddleware
from .seed import backfill_local_user_passwords, ensure_bootstrap_owner, seed_if_empty
from .session_lifecycle import SessionLifecycleMiddleware
from .upload_access import UploadAccessMiddleware
from .upload_safety import UploadSafetyMiddleware
from .write_contract import WriteContractMiddleware


security = load_security_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_security_settings(security)
    with SessionLocal() as db:
        seed_if_empty(db)
        ensure_bootstrap_owner(db)
        backfill_local_user_passwords(db)
    yield


app = FastAPI(
    title="Manager Operations Command Center",
    version="3.19.0",
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
app.add_middleware(IdentityBoundaryMiddleware)
app.add_middleware(RoleBoundaryMiddleware)
app.add_middleware(DecisionBoundaryMiddleware)
app.add_middleware(UploadSafetyMiddleware)
app.add_middleware(UploadAccessMiddleware)
app.add_middleware(SessionLifecycleMiddleware)
app.add_middleware(AuthorizationFreshnessMiddleware)
app.add_middleware(InternalReadBoundaryMiddleware)
app.add_middleware(ApiReadBoundaryMiddleware)
app.add_middleware(CsrfProtectionMiddleware)
app.add_middleware(WriteContractMiddleware)
app.add_middleware(SecurityAuditMiddleware)


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


def remove_shadowed_legacy_routes() -> None:
    shadowed_paths = {
        "/api/review/queue",
        "/api/workflow/approvals/{approval_id}/decide",
        "/api/users",
    }
    router.routes[:] = [
        route
        for route in router.routes
        if getattr(route, "path", None) not in shadowed_paths
    ]


remove_shadowed_legacy_routes()
app.include_router(review_router)
app.include_router(my_work_router)
app.include_router(authorization_hotfix_router)
app.include_router(router)
app.include_router(integrations_v2_router)
app.mount("/uploads", StaticFiles(directory=os.getenv("UPLOAD_DIR", "./uploads")), name="uploads")
