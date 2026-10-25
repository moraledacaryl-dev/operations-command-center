# Interactive staff training: rollout and acceptance

The Training button launches visual walkthroughs inside authenticated Operations pages **only when the frontend was explicitly built with NEXT_PUBLIC_TRAINING_MODE=true**. Normal production builds do not show the launcher. It shows a popup, highlights the relevant control, and draws an arrow. The user can navigate Back, Next, All lessons, or Exit.

## What it does, and does not do

The overlay does not automatically save, approve, submit, verify, publish, or delete records. Staff can advance steps without performing the action. A Tour viewed marker **is not a staff certification**. Markers are stored locally in the browser for each user and do not transfer between devices.

Role visibility depends on the actual capability payload. Staff get orientation and read-only modules; supervisors/leads with manage_department get department-workflow modules; managers with make_decisions see Review; users with manage_accounts see People & Access. Only marketing members with department-management access can access the advanced Marketing tutorial.

## Safeguards

- Never type and submit fictional training data in production. Open the form and cancel instead.
- Hands-on exercises require a distinct **training database**, upload directory, user credentials, and disabled external integrations. This PR does not create the training website or its database.
- Any training environment should be plainly labeled TRAINING — FICTIONAL DATA. The pre-existing demo banner flag is only a visual label, not data isolation.
- Use individual fictional employee accounts corresponding to each permission tier.
- Use the supervisor-led assessment and sign-off process from the existing training manuals before marking an employee operationally qualified.

## Acceptance checks

1. Staff login: library shows only read-only lessons. No task-creation, approvals or administration lessons.
2. Orientation: popup and arrow point to the workspace header; advancing to My Work navigates correctly; Escape exits.
3. Supervisor: task tour navigates to Tasks; New task opens its form; Cancel closes it with **no POST**.
4. Supervisor: request tour opens and cancels New request without saving.
5. Manager: Review tutorial visible, account administration tutorial hidden.
6. Administrator: People & Access tutorial visible.
7. Login page: Training button is absent.
8. Mobile at 390 px: lesson library is readable and scrollable; popup fits; arrows track controls.
9. Scrolled/zoomed UI: overlays remain aligned, focused controls remain clickable.
10. Review Playwright screenshots captured by the Verify workflow.

## Suggested local verification commands

Run in the frontend directory:

    npm ci
    npm run lint
    npm run typecheck
    npm run build
    npx playwright test e2e/interactive-training.spec.ts

Review the GitHub Actions Verify browser job and its ui-audit-screenshots artifact. It includes staff library, spotlight arrow, mobile library, manager library, and task-form screenshots. Do not deploy to production until browser/visual QA and the separate isolated training environment have been accepted.
