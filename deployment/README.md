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

Operations frontend should use the server-side API proxy:

```bash
SERVER_API_BASE=http://127.0.0.1:8200/api
```

Do not use `NEXT_PUBLIC_API_BASE` for production Operations deploys. The browser should talk to the Next app, and the Next app should talk to FastAPI.

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

The scripts:

- use `set -euo pipefail`
- refuse missing or placeholder env files
- avoid printing secret values
- build in a timestamped release directory
- switch the `current` symlink only after compile/build succeeds
- install systemd units from this repo
- restart only the target service

`deploy-accounting.sh` and `deploy-pos.sh` are conservative guard scripts because those apps are already live. They validate env presence, back up `/opt`, and stop before replacing live files.

`deploy-all-safe.sh` runs nginx backups, Accounting/POS guard checks, then Operations/Staff deployment. Root launcher cutover remains a separate manual gate.
