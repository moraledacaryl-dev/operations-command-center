# Test Results

Date: 2026-06-09

## Operations

- Command: server health checks for existing live apps
  - Result: passed for Accounting and POS
  - Details: `https://accounting.hiddenoasis.app/healthz` returned 200; `https://pos.hiddenoasis.app/healthz` returned 200 after restarting POS services.
- Command: live POS accounting sync verification
  - Result: passed
  - Details: live `accounting_sync` row now points at `https://accounting.hiddenoasis.app/api`, and recent sync-worker logs showed Accounting token/catalog/calendar calls to that subdomain.
- Command: `bash -n deployment/scripts/*.sh`
  - Result: passed
  - Details: deployment scripts parse successfully.
- Command: UI copy scan for final-pass banned phrases in `frontend`, `backend`, `deployment`, and `docs`
  - Result: passed for operational UI
  - Details: no flagged phrases remain in Operations app screens or launcher assets.
- Command: `PYTHONPYCACHEPREFIX=/tmp/pycache-ops python3 -m compileall backend/app backend/tests`
  - Result: passed
  - Details: backend application and tests compile after integration-key hardening.
- Command: `PYTHONPATH=backend PYTHONPYCACHEPREFIX=/tmp/pycache-ops python3 -m unittest backend.tests.test_auth_helpers`
  - Result: passed
  - Details: 2 auth helper tests passed.
- Command: direct execution of `backend/tests/test_cross_app_integrations.py` test functions
  - Result: not run
  - Reason: this local shell has no `sqlalchemy` module.
  - Classification: environment/dependency gap, not a code failure.
- Command: frontend build/lint
  - Result: not run
  - Reason: this local shell has no `node`/`npm`; the Hetzner server does have Node 20/npm 10 and the deploy script runs the build before switching releases.
  - Classification: environment/dependency gap.

Next action: install backend/frontend dependencies in the Operations environment, then run `python3 -m pytest backend/tests/test_cross_app_integrations.py`, `npm run build`, and `npm run lint`.
