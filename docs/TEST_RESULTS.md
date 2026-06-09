# Test Results

Date: 2026-06-09

## Operations

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
  - Reason: this local shell has no `node`/`npm`.
  - Classification: environment/dependency gap.

Next action: install backend/frontend dependencies in the Operations environment, then run `python3 -m pytest backend/tests/test_cross_app_integrations.py`, `npm run build`, and `npm run lint`.
