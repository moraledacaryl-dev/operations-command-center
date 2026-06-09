# Manager Operations Command Center

A minimalist, semi-Notion-like operations command center for Hidden Oasis-style hotel, café, restaurant, and marketing operations.

This is the **manager brain**, not the Staff App, POS, Accounting Program, payroll, or a full general chat app.

## Main sidebar

Daily pages:

- Home
- Departments
- Projects
- Tasks
- Requests
- Shift
- Guests
- Fixes
- Rooms
- Posts
- Review
- History

Admin pages are tucked away:

- Admin → Users
- Admin → Health
- Admin → Approve

## Core philosophy

- Login is per person, not per department.
- One person can belong to multiple departments.
- Staff/lead users land on their primary department workspace.
- Manager/owner users land on Home.
- Departments act like small operational workspaces.
- Completed/approved/resolved/posted items hide into History.
- Official Purchase Requests stay in Accounting, not this app.

## Department workspace tabs

Each department can have:

- Tasks
- Talk
- Requests
- Projects
- Routine
- Docs
- People
- History

This gives a semi-Notion feel without making the app blank or bloated.

## Requests

Requests are department-level proposals or operational asks:

- Equipment
- Policy
- Process
- Staffing
- Supply
- Marketing
- Maintenance
- Event
- Other

If buying is required, link the approved request to an official Accounting PR later. Do not duplicate Purchase Requests here.

## Routine templates

Recurring work lives under departments and generates active tasks only when needed.

Examples:

- weekly café inventory count
- general cleaning check
- marketing review
- AC filter check
- café opening/closing

Future routines stay hidden. Only generated active tasks appear in Tasks/Home.

## Review

Review combines manager decision queues:

- Inbox submissions
- Approvals
- Requests for decision
- Posts needing review
- Fixes needing verification

## Local Mac launch

Recommended first run:

1. Install/open Docker Desktop.
2. Double-click `Open Operations Command Center.command`.
3. Wait for it to build/start.
4. Browser opens to `http://localhost:3000/login`.

Local login:

- Email: `caryl@example.com`
- Password: value from `LOCAL_SEED_PASSWORD` in local mode. The Mac example defaults to `command123`.

Production bootstrap:

- Set `ALLOW_DEMO_SEED=false`
- Set `ALLOW_DEFAULT_ADMIN_BOOTSTRAP=true`
- Set `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME`, and a strong `BOOTSTRAP_OWNER_PASSWORD`
- Set a real `SESSION_SECRET`
- After first login, create/reset the rest of the team accounts in `Admin -> Users`

Mac files included:

- `Operations Command Center.app`
- `Open Operations Command Center.command`
- `Stop Operations Command Center.command`
- `Reset Local Data.command`
- `MAC_OPEN_THIS_FIRST.md`

## Docker run

```bash
docker compose up --build
```

Frontend: `http://localhost:3000`  
Backend: `http://localhost:8000/api/health`

## Manual local run

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

## Boundaries

Accounting owns:

- Purchase Requests
- Purchase Orders
- supplier bills
- expenses
- financial records

POS owns:

- sales
- orders
- payments
- receipts
- room charges

Future Staff App owns:

- staff capture
- photo proof
- shift start/end
- QR room/area reports
- personal task completion

Command Center owns:

- planning
- manager review
- approval
- assignment
- department requests
- marketing review
- room/area memory
- history/search

## Still test before deployment

- Mac launcher on your Mac
- login and department landing
- multi-department switcher
- routine task generation
- Review actions
- iPad post markup/touch behavior
- browser/mobile layout
- VPS/domain/HTTPS deployment
- future Staff App / Accounting / POS integration
