# Hidden Oasis Deployment Assets

These files prepare the existing Hetzner VPS deployment for:

- `hiddenoasis.app` static launcher
- `accounting.hiddenoasis.app` Accounting
- `pos.hiddenoasis.app` POS
- `operations.hiddenoasis.app` Operations Command Center
- `staff.hiddenoasis.app` Staff & Payroll

The live server audit on 2026-06-09 found the current running ports:

- Accounting frontend: `127.0.0.1:3000`
- Accounting backend: `127.0.0.1:8000`
- POS frontend: `127.0.0.1:3100`
- POS backend: `127.0.0.1:8100`

The templates add planned ports:

- Operations frontend: `127.0.0.1:3200`
- Operations backend: `127.0.0.1:8200`
- Staff/Payroll Streamlit: `127.0.0.1:8501`

Do not switch `hiddenoasis.app` to the launcher until all four app subdomains are verified. Use `nginx/hidden-oasis-subdomains.conf` first, then `nginx/hidden-oasis-launcher-cutover.conf` after Accounting, POS, Operations, and Staff all pass HTTPS and login checks.

For versioned (`/api/integrations/v2/events/{source_app}`) integrations, use
distinct per-source keys in Operations' protected
`/etc/hiddenoasis/operations.env` environment file. **Shell-quote the entire
JSON value**, or sourcing the file will destroy JSON syntax:

```bash
INTEGRATION_API_KEYS_JSON='{"hidden_oasis_staff_payroll":"STAFF_SECRET","accounting_program":"ACCOUNTING_SECRET","dedicated_pos_cloud":"POS_SECRET","inventory_procurement":"INVENTORY_SECRET"}'
```

These are format placeholders, not usable secrets. Replace each with a different
random value and provision the corresponding source application with its own key.
Never print or commit real integration credentials. Unlike development, production
v2 events do **not** fall back to `INTEGRATION_API_KEY`. The older
`/api/integrations/staff/events`, `/api/integrations/accounting/status` and
`/api/integrations/pos/status` receivers still use the legacy shared key until
producers migrate.

The canonical deployment preflights the sourced JSON before backups/migrations
and aborts with a non-secret error if it is malformed or contains duplicate keys.
To correct an existing `INTEGRATION_API_KEYS_JSON={...}` assignment, edit it
in place using `sudo nano /etc/hiddenoasis/operations.env` and add a **single
quote at each end of the existing JSON**. Keep the existing secret values
unchanged; do not paste them into tickets or chat.

## Server Source Layout

Use `/root/repos` as the source/staging area and `/opt` as live deployment output.

- `/root/repos/accounting-program-online`
- `/root/repos/pos-cloud-online`
- `/root/repos/operations-command-center`
- `/root/repos/hidden-oasis-staff-payroll`

Do not clone or pull directly inside `/opt`. Build and test from `/root/repos`, then deploy through a script or an equivalent gated release process.

## Scripts

Run from the Operations repo on the server:

```bash
cd /root/repos/operations-command-center
deployment/scripts/deploy-operations.sh
deployment/scripts/deploy-staff.sh
```

`scripts/deploy_production.sh` is the canonical Operations deployment gate;
`deployment/scripts/deploy-operations.sh` is a compatibility wrapper only.

The Operations deployment:

- use `set -euo pipefail`
- refuse missing or placeholder env files
- avoid printing secret values
- exports the exact `origin/main` SHA into an immutable SHA-named release
- runs backend tests plus frontend lint/typecheck/standalone build in the candidate
- pairs a checksummed PostgreSQL backup with a checksummed uploads backup
- stamps the release SHA and Alembic head in a manifest
- switches the `current` symlink only after all pre-activation gates succeed
- runs authenticated smoke through the public origin and checks the live SHA
- flips `current` back to the prior immutable release on post-activation failure
- install systemd units from this repo
- restart only the target service

The production environment must set `ENVIRONMENT=production`, use the public
HTTPS origin in `ALLOWED_ORIGINS`, and set `TRUST_PROXY_HEADERS=true` with
`TRUSTED_PROXY_IPS=127.0.0.1` because nginx is the only trusted hop to Uvicorn.
The Compose stack intentionally defaults to `ENVIRONMENT=local` for its
localhost gateway; production Compose deployments must override the origin,
host, and environment together.

`deploy-accounting.sh` and `deploy-pos.sh` are conservative guard scripts because those apps are already live. They validate env presence, back up `/opt`, and stop before replacing live files.

`deploy-all-safe.sh` runs nginx backups, Accounting/POS guard checks, then Operations/Staff deployment. Root launcher cutover remains a separate manual gate.


## Post-deployment integration delivery audit (read-only)

After the canonical Operations deployment reports `DEPLOYMENT GATE: PASS`,
check whether real source events from Staff/Payroll, Accounting, POS and
Inventory have actually arrived in the configured time window. The following
reads Operations database metadata only; it **does not post synthetic events,
alter a Review decision, access payloads or print credentials**.

```bash
sudo bash -c '
set -a
source /etc/hiddenoasis/operations.env
set +a
cd /opt/operations-command-center/current/backend
PYTHONPATH=. .venv/bin/python -m scripts.audit_integration_deliveries --hours 168
'
```

The result is a JSON report with `read_only: true`, one row per registered
source, last observed v2 delivery timestamp, recent delivery counts, legacy
Review rows, and any v2 deliveries missing an Inbox or Review entry. It reports
`not_observed` or `no_recent_event` **without** claiming a source is
disconnected: some event categories are naturally infrequent, and legacy
receivers may still be in use. `structural_integrity: pass` means only that
the existing v2 delivery graph has no detected missing links or nonprocessed
deliveries; it is not a live producer/receiver certification.

Exit code 2 indicates missing v2 Review/Inbox links or unprocessed deliveries.
To require at least one v2 event from *all four* sources during a controlled
canary window, add `--require-all-sources` (exit code 3 if coverage is missing).
Use distinct real source-side test events when safe, rather than replaying or
forging actual financial/HR transactions. No real API keys are printed or
required on the command line.
