# Operations Production Hardening

This app is already Next.js plus FastAPI. Do not migrate it to another frontend stack just to modernize it.

## Current Direction

- Next.js is the browser app.
- FastAPI owns data, auth, uploads, integrations, and permissions.
- Browser requests go to the Next app first.
- Next proxies API calls to FastAPI using `SERVER_API_BASE`.
- Session tokens are kept in an HttpOnly cookie named `cc_session`.
- Frontend runtime requires Node.js `>=20.9.0`.

## Required Environment

Use placeholder values only in committed docs.

```bash
ENVIRONMENT=production
SERVER_API_BASE=http://127.0.0.1:8200/api
SESSION_SECRET=replace-with-long-random-secret
SESSION_TTL_SECONDS=1209600
INTEGRATION_API_KEY=replace-with-shared-secret
ALLOWED_ORIGINS=https://operations.hiddenoasis.app
ALLOW_DEMO_SEED=false
ALLOW_DEFAULT_ADMIN_BOOTSTRAP=true
BOOTSTRAP_OWNER_EMAIL=owner@example.com
BOOTSTRAP_OWNER_NAME=Operations Owner
BOOTSTRAP_OWNER_PASSWORD=replace-with-first-login-password
UPLOAD_DIR=/var/lib/hiddenoasis/operations/uploads
DATABASE_URL=sqlite:////var/lib/hiddenoasis/operations/operations.db
```

Do not set `NEXT_PUBLIC_API_BASE` for production. Browser-direct API tokens are intentionally avoided.

## Deploy Checklist

1. Pull the GitHub branch or merged `main`.
2. Install backend dependencies in the backend virtualenv.
3. Confirm Node.js is `>=20.9.0`.
4. Install frontend dependencies and build Next.
5. Confirm `/api/health` has no production readiness warnings.
6. Restart backend and frontend services.
7. Confirm login, dashboard, review queue, uploads, and admin users.

## Migration Discipline

The backend still has startup schema backfills for older local databases. That is acceptable for the current SQLite rollout, but future production schema changes should be moved into one-time migration scripts before removing the startup fallback.

Before any database change:

```bash
sqlite3 /var/lib/hiddenoasis/operations/operations.db ".backup '/root/backups/operations/operations-before-update.db'"
```

Then run the documented migration script for that release.

## Backup Reminder

Back up both:

- the database file
- the upload directory

Keep at least one off-server copy using S3-compatible storage, rclone, or rsync to another server.
