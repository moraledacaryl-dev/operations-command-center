import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

ENVIRONMENT = os.getenv("ENVIRONMENT", "local").lower()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./command_center.db")

if ENVIRONMENT in {"production", "staging"} and DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("PostgreSQL is required outside local/test environments. Set DATABASE_URL.")

engine_options = {
    "pool_pre_ping": True,
    "future": True,
}

if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
else:
    engine_options.update(
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800")),
    )

engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
