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

Before direct cross-app POST testing, install the same real `INTEGRATION_API_KEY` in Accounting, POS, Operations, and Staff/Payroll server settings. The committed files only contain placeholders.

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
