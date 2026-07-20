import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import integration_models  # noqa: F401 - register integration tables with SQLAlchemy
from .database import SessionLocal
from .routers.api import router
from .routers.integrations_v2 import router as integrations_v2_router
from .seed import backfill_local_user_passwords, ensure_bootstrap_owner, seed_if_empty


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Schema changes are applied only through Alembic before the API starts.
    with SessionLocal() as db:
        seed_if_empty(db)
        ensure_bootstrap_owner(db)
        backfill_local_user_passwords(db)
    yield


app = FastAPI(title="Manager Operations Command Center", version="3.1.0", lifespan=lifespan)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(integrations_v2_router)
app.mount("/uploads", StaticFiles(directory=os.getenv("UPLOAD_DIR", "./uploads")), name="uploads")
