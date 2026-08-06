# Operations Command Center release verification

## Automated gates

A release candidate must pass:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v

cd ../frontend
npm ci
npm run lint
npm run typecheck
npm run build
```

The frontend build must complete without SWC lockfile patch warnings.

## Role matrix

Verify each route using Owner, Admin, Manager, Lead/Supervisor, Staff, and signed-out sessions.

- Today
- My Work
- Department
- Tasks
- Projects
- Requests
- Shift Handover
- Guest Matters
- Maintenance
- Marketing
- Review
- Approvals
- Rooms and room detail
- History
- People & Access
- System Health

For every role, verify navigation visibility, direct URL access, API reads, API writes, and sensitive-field visibility.

## Viewports

- Desktop: 1440 × 900
- Tablet: 834 × 1194
- Mobile: 390 × 844

## Required states

- Empty
- Populated
- Loading
- Error
- Unauthorized direct URL
- Drawer open
- Form open
- Validation failure
- Successful action

## Interaction checks

- Drawers expose dialog semantics.
- Initial focus enters the drawer.
- Tab and Shift+Tab remain inside.
- Escape closes the drawer.
- Focus returns to the trigger.
- Background scrolling is locked.
- Mobile bottom navigation does not cover modal content.
- Clickable cards work with keyboard activation.
- Active filters retain readable labels.
- No page has horizontal overflow at 390 px.
- User-facing errors never expose raw backend payloads.

## Workflow checks

- Review queue loads and decisions complete.
- My Work contains only the signed-in employee's assignments across permitted departments.
- Requests move through proposal, decision, planning, and completion.
- Shift notes can be acknowledged, carried forward, and resolved.
- Maintenance moves Open → Working → Done → Verified.
- Marketing moves Idea → Draft → Review → OK → Set → Posted.
- Legacy approval routes redirect to `/approvals`.
- Room pages show the correct guest and maintenance history.
- History filters survive reload and can be shared by URL.
