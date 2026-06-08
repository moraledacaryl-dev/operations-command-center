import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from .database import Base, engine, SessionLocal
from .routers.api import router
from .seed import seed_if_empty

app = FastAPI(title="Manager Operations Command Center", version="2.9.0")

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

Base.metadata.create_all(bind=engine)

def ensure_local_schema():
    inspector = inspect(engine)
    additions = {
        "guest_notes": ["department_id INTEGER"],
        "fixes": ["department_id INTEGER"],
        "posts": ["department_id INTEGER"],
    }
    with engine.begin() as conn:
        for table, columns in additions.items():
            existing = {column["name"] for column in inspector.get_columns(table)}
            for column_sql in columns:
                column_name = column_sql.split()[0]
                if column_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_sql}"))

ensure_local_schema()
with SessionLocal() as db:
    seed_if_empty(db)

def backfill_local_departments():
    with engine.begin() as conn:
        conn.execute(text("UPDATE guest_notes SET department_id = (SELECT id FROM departments WHERE name = 'Front Desk') WHERE department_id IS NULL"))
        conn.execute(text("UPDATE fixes SET department_id = (SELECT id FROM departments WHERE name = 'Maintenance') WHERE department_id IS NULL"))
        conn.execute(text("UPDATE posts SET department_id = (SELECT id FROM departments WHERE name = 'Marketing') WHERE department_id IS NULL"))

backfill_local_departments()

app.include_router(router)
app.mount("/uploads", StaticFiles(directory=os.getenv("UPLOAD_DIR", "./uploads")), name="uploads")
