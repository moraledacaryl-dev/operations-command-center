# Hidden Oasis Workspace Integration Audit

Date: 2026-06-09

## Repositories

| Repo | Found | Branch checked | Status | GitHub/clean-main note |
| --- | --- | --- | --- | --- |
| accounting-program-online | yes | Desktop recovery branch; `/tmp` main clone | Desktop clean; `/tmp` has one untracked Unicode docs artifact | use `/tmp/audit-accounting-program-online` for main commits |
| pos-cloud-online | yes | Desktop recovery branch; `/tmp` main clone | clean | use `/tmp/audit-pos-cloud-online` for main commits |
| operations-command-center | yes | main | deployment assets updated in this pass | active local workspace and GitHub main |
| hidden-oasis-staff-payroll | yes | main | clean | `/tmp/audit-hidden-oasis-staff-payroll` also clean before this pass |

## Detected Stacks

| App | Frontend | Backend | Data | Tests |
| --- | --- | --- | --- | --- |
| Accounting | Next.js | FastAPI | SQLAlchemy, PostgreSQL/live, SQLite-capable local | pytest backend, Next build |
| POS | Next.js | FastAPI | SQLAlchemy, PostgreSQL/live, local DB support | pytest backend, Node smoke/UI tests |
| Operations | Next.js TypeScript | FastAPI | SQLAlchemy with startup schema upgrades | unittest/pytest-style backend, Next build |
| Staff/Payroll | Streamlit | Streamlit/Python modules | SQLite helpers | unittest, smoke_test.py |

## Integration Status

- Staff/Payroll emits Accounting and Operations envelopes with `external_source`, `external_id`, `event_type`, `source_record_type`, `source_record_id`, `generated_at`, `schema_version`, and `payload`.
- Accounting has `/api/integrations/payroll/*` receiver endpoints, `IntegrationReceipt`, review queue APIs, idempotency, journal previews, employee reference sync, approve/reject/post actions, and tests.
- POS has `GET /api/reports/daily-ops-context?date=YYYY-MM-DD`, flat operational totals, a `daily_sales_context` envelope, no PII in the response, and tests.
- Operations has `ExternalReviewItem`, idempotent Staff/Accounting/POS receiver endpoints, overview cards, mark-seen/reject/create-task/create-approval actions, scrubbing, and tests.
- Staff/Payroll keeps ZIP export fallback and now supports direct posting of Ready events to Accounting and Operations review endpoints.
- Direct cross-app POSTs use `X-Integration-Api-Key`; production receivers reject missing or placeholder keys.

## Live Server Audit Summary

- Server: `89.167.28.163`, hostname `ubuntu-4gb-hel1-2`
- OS: Ubuntu 24.04.4 LTS
- Public services: nginx on ports 80/443, SSH on 22
- Datastore: PostgreSQL 16 on localhost
- Current live apps: Accounting and POS
- Staged apps in `/root/repos`: Accounting, POS, Operations, and Staff/Payroll
- Running units: `accounting-backend`, `accounting-frontend`, `pos-backend`, `pos-frontend`, `pos-sync-worker`
- Current ports: Accounting `127.0.0.1:3000` and `127.0.0.1:8000`; POS `127.0.0.1:3100` and `127.0.0.1:8100`
- Current certs observed: `hiddenoasis.app`, `accounting.hiddenoasis.app`, `pos.hiddenoasis.app`
- DNS checked from server: `hiddenoasis.app`, `accounting.hiddenoasis.app`, `pos.hiddenoasis.app`, `operations.hiddenoasis.app`, and `staff.hiddenoasis.app` resolve to `89.167.28.163`
- `https://accounting.hiddenoasis.app/healthz` returned `{"ok":true,"environment":"production"}`
- `https://pos.hiddenoasis.app/healthz` returned 200 after restarting `pos-backend` and `pos-sync-worker`
- POS live `system_settings.accounting_sync` was repaired from `https://hiddenoasis.app/api` to `https://accounting.hiddenoasis.app/api`
- Recent POS sync-worker logs showed token/catalog/calendar calls to `https://accounting.hiddenoasis.app/api`

## High-Risk Areas

- `hiddenoasis.app` still serves Accounting; do not switch it to the launcher until `accounting.hiddenoasis.app` works with UI, API, login, and critical routes.
- `operations.hiddenoasis.app` and `staff.hiddenoasis.app` still need live systemd services, nginx vhosts, SSL certificates, and browser checks.
- Staff/Payroll remains a Streamlit prototype; expose it only for controlled internal production use until a FastAPI/PostgreSQL/Next.js rebuild is done.
- Desktop Accounting/POS repos are recovery branches; use clean main clones for GitHub commits.
- Real `INTEGRATION_API_KEY` must be installed in each server-side app environment before direct POST testing.
- Secret rotation is still recommended after deployment troubleshooting because server secrets were handled during the wider setup process.

## Priority Order

1. Keep Accounting published on `accounting.hiddenoasis.app` while leaving root unchanged.
2. Deploy Operations on internal ports `3200/8200` and add nginx/SSL for `operations.hiddenoasis.app`.
3. Deploy Staff/Payroll on internal port `8501` and add nginx/SSL for `staff.hiddenoasis.app`.
4. Smoke test cross-app URLs and receiver endpoints.
5. Switch `hiddenoasis.app` to the static launcher only after all four subdomains are proven.
