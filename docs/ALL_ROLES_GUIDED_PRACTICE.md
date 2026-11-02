# Hidden Oasis — One-task-at-a-time training for all roles

## Why the experience changed
The staff interface must explain what to do **now**, which real control to use, and how the result is checked. A long lecture, a quiz, and several competing overlays are not a clear substitute for doing real work.

## Three stages in every role lesson
1. **Show me:** a short, fictional example of the exact skill, independent of the answer to any graded case.
2. **Help me do it:** one instruction at a time on the real, isolated Operations screens; highlights show where the correct control is. Required clicks must be made by the employee.
3. **Your turn:** repeat key actions without arrows by default, with an optional help panel. Real records are checked where the lesson reads or writes a synthetic training record. For navigation-only lessons, the result proves only use of the real controls, not workplace competence.

All 13 structured lesson types use the same practice-plan component: orientation, handover, rooms, My Work, team tasks, guest matters, maintenance, requests, shift writing, projects, marketing, management review and accounts. The scenario library of 117 fictional situations gets an equivalent example / guidance / independent-answer introduction, but its answer rubric remains distinct from the real-record exercises.

## Department-specific task (frontline)
For a normal staff account from Front Desk, Housekeeping, Café, Kitchen, Maintenance, Marketing or Security, the compulsory **Reading a shift handover** lesson now uses the real Shift handover page and their own department's seeded fictional notes:

- **Guided:** choose Urgent, find `[TRAINING] {department} Night handover #3`, open it, read its actual saved status and check the answer (initially Follow).
- **Independent:** find `[TRAINING] {department} PM handover #2` without arrows, open it and check its saved status (initially Seen).
- Status answers are verified by re-reading the specific record from the authenticated local practice API, including its ID, title and department. An unrelated record or guessed status cannot advance the course. The action is read-only.
- An incorrect answer gives a hint and allows a retry; the employee can repeat the entire lesson without losing past completed results.

Front Desk's additional compulsory **Rooms** practice uses Solace and Perch 1, with saved fictional AC/towel reports and the same guided → independent sequence.

Leads, supervisors and managers retain role-scoped practice workflows. Editing scenarios require saved work to be verified against the isolated practice database. Navigation and read-only lessons do not falsely claim to certify workplace skills or grant more permissions.

## Test scope
- One fresh receptionist runs all compulsory lessons on the unmocked local training backend.
- A manager performs the existing real-backend saved task exercise and retains normal approvals/permission boundaries.
- Browser tests run department-specific handovers for each of seven staff departments with mocked data, plus wrong-answer and tamper checks.
- The full browser regression suite, frontend lint/types/build, backend security, seed verification and native Mac/Windows packagers must succeed against **the latest PR head**.
- Existing Mac/Windows local training history is preserved. Updated named-room cases are added only to an already-validated private, synthetic training DB. No real PMS, guest, payroll, POS or Accounting records are imported.

## Release gates
PR #224 is a draft stacked on #222. Neither may be merged or used to deploy production as part of this change. Staff-device acceptance (including the unsigned first-launch experience), language/usability observation with staff, and signing/notarization remain separate requirements.

The first practical acceptance test is for an employee to finish the guided step, make a wrong choice and recover, then complete a second case without an arrow or verbal assistance from the trainer.
