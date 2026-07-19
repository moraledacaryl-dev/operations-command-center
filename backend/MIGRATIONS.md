# Database migrations

The application schema is owned by Alembic. The API must not call `Base.metadata.create_all()` or issue runtime `ALTER TABLE` statements.

## Container startup

The backend container runs:

```bash
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Docker Compose uses PostgreSQL by default. Local non-container development may still use SQLite when `ENVIRONMENT=local` or `ENVIRONMENT=test`.

## Apply migrations manually

```bash
cd backend
alembic upgrade head
```

## Create a migration

After changing SQLAlchemy models:

```bash
cd backend
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

Review every generated migration before committing it. New migrations must use explicit Alembic operations and must include a safe downgrade where practical.

## Production rules

- Set `ENVIRONMENT=production` or `ENVIRONMENT=staging`.
- Set a PostgreSQL `DATABASE_URL`.
- Back up the database before applying a release migration.
- Apply migrations once per release before serving application traffic.
- Never point production at SQLite.

## First migration

`0001_production_foundation` is intentionally compatible with both a fresh database and the existing pre-Alembic schema. It creates missing tables, preserves existing operational data, adds the legacy columns previously created during startup, and records the database at the Alembic baseline.
