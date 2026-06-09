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

Do not switch `hiddenoasis.app` to the launcher until `accounting.hiddenoasis.app` is fully verified. Use `nginx/hidden-oasis-subdomains.conf` first, then `nginx/hidden-oasis-launcher-cutover.conf` after the Accounting subdomain is safe.

Before direct cross-app POST testing, install the same real `INTEGRATION_API_KEY` in Accounting, POS, Operations, and Staff/Payroll server settings. The committed files only contain placeholders.
