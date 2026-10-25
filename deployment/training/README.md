# Hidden Oasis Operations — Isolated training website

This is an **additional local training stack**, never a replacement for production. It starts a copy of the Operations frontend and backend, backed by a fresh SQLite database filled with fictional records. The entry point is restricted to **127.0.0.1**. The backend, initializer, and frontend are confined to an internal-only Docker network. The Nginx gateway also joins a separate edge bridge so its published **127.0.0.1** port works; it is the only container with that network attachment.

The interactive popups/arrows are provided by **PR #213**. This training stack is **PR #214**; merge both features before staff use, or run this stack from a checkout containing both features.

## Prerequisites

Docker Engine and Docker Compose v2; enough free disk for two application builds. Use a **fresh checkout**, never the production deployment checkout or a production environment file. There is **no need for production SSH, PostgreSQL credentials, or an existing database backup**.

From the fresh checkout root, create a **new local-only** secrets file named `.env.training.private`. It is not part of the repository:

    TRAINING_PORT=3401
    TRAINING_SESSION_SECRET=<your independently generated 48+ character secret>
    TRAINING_INTEGRATION_API_KEY=<another independent 48+ character secret>

Generate separate random values on your own computer with Python `secrets.token_urlsafe(48)`. Do not copy values from the production Operations, Payroll, POS, Inventory or Accounting apps. Keep this file private, with permissions 0600. Never commit it or paste it into a chat.

**The training services do not connect to Accounting, POS, Payroll or Inventory.** The backend/frontend network has `internal: true` and cannot reach external services; the gateway uses a second bridge solely for loopback port publication. The website is accessible only from the same host at the loopback address.

## Verify the config and start

    docker compose --env-file .env.training.private -f docker-compose.training.yml config
    docker compose --env-file .env.training.private -f docker-compose.training.yml up --build -d

The `training-init` service migrates and fills the database **only on the first startup**. A completion marker prevents accidental duplicate seeding. It refuses an incomplete or pre-populated database rather than clearing it.

Check:

    docker compose --env-file .env.training.private -f docker-compose.training.yml ps
    curl -i http://127.0.0.1:3401/api/readyz
    curl -I http://127.0.0.1:3401/login

The `readyz` response must report `ready:true`; the login page must show the training/demo banner. If the backend is unhealthy, check only the training-specific Compose logs. Do not stop or modify production services.

## Retrieve demo credentials privately

The seeder creates twenty fictional logins with unique random passwords. The credential roster is stored only in the `training_private_credentials` Docker volume; it is **not** mounted in the running API or frontend.

To save a copy on the operator's machine, use a restrictive umask and redirect the output directly to a private file:

    umask 077
    docker compose --env-file .env.training.private -f docker-compose.training.yml run --rm --no-deps --entrypoint cat training-init /training/private/accounts/PRIVATE_training_accounts.json > training_accounts_PRIVATE.json
    chmod 600 training_accounts_PRIVATE.json

This roster contains passwords. Do not put it on a public website, shared drive, GitHub, or in an employee handout. Give each trainer/employee **only their own** fictional account. Suggested demos: `manager@training.invalid`, `frontdesk-lead@training.invalid`, and `reception-am@training.invalid`.

## Staff access from another computer

By design, the training gateway **does not** listen publicly or on the LAN. For a temporary operator preview, a technically authorized person may use an SSH tunnel:

    ssh -L 3401:127.0.0.1:3401 <authorized-user>@<training-host>

The user then opens `http://127.0.0.1:3401` on their computer. Do not reuse the production host without an infrastructure review. For broader staff access, a separate private DNS/VPN/TLS configuration and explicit origin/host security review are required. That is **not** supplied automatically by these files.

## What employees can practise

- My Work, task boards/lists and role-appropriate permissions
- Front Desk guest matters and linked maintenance
- Shift handovers, inspections and overdue follow-ups
- Supervisor work assignment, requests, and workflows
- Manager decisions, maintenance verification and approvals
- Marketing draft/revision/scheduling states
- Department routines, documents, collaboration and project purchases

Every training title is marked `[TRAINING]`. The staff guide explains the corresponding practical exercises. The interactive tour labels a lesson **Tour viewed**, not **Certified**; use the separate supervisor sign-off assessment.

## Persistence and reset

Records persist through container restarts in **training-only** named volumes. The stack will not automatically erase staff practice. To rebuild, first archive necessary exercise evidence. Resetting must be an explicit authorized decision after reviewing the actual Compose project and volumes. Never run an unscoped or production `down -v` command.

The training initializer deliberately fails closed if a database exists without its completion marker. Do not bypass this by editing the script or by pointing it at any production database.

## Acceptance gate before inviting staff

1. CI training-seed verification passes on a migrated, empty SQLite database.
2. Training initialization and health succeed in a new isolated instance.
3. All synthetic user roles can log in only with their own credentials.
4. Task/guest/fix/shift/request queues show appropriately fictional content.
5. Staff cannot access management-only actions; supervisor and manager flows work.
6. The training banner stays visible and production URLs, databases, and integrations are absent.
7. The interactive walkthrough screenshots and permission checks from PR #213 pass on this separate instance.
8. The operator verifies port 3401 is bound to **127.0.0.1**, not 0.0.0.0.
9. Only after these checks, authorize supervised employee training.

This PR **does not deploy a public training website** and does not run against the resort's production data.
