# Operations desktop training — UI and functional parity audit

**Scope:** compare branch `training/comprehensive-situations-and-assessment` with the checked-out `main` Operations app, using isolated fictional records only. This is a source/behavior audit; it is not a pixel comparison to the authenticated production VPS or an Apple Developer notarization certificate.

## Contract by surface

| Surface | UI and API parity | Training evidence | Known limitation |
| --- | --- | --- | --- |
| Navigation, layouts and module forms | Same real Next.js pages and shared components; CI asserts their Git blobs match main | Full Chromium regression, role-aware tours, desktop packaging smoke | Extra training coach and banner intentionally appear only in training |
| Tasks | Actual Tasks create and state API | Saved Task, real assignee, To Do → Doing → Review | No full supervisor approval/return-for-changes exercise |
| Guest Matters | Actual Guest Matters page and persisted GuestNote actions | AC complaint → Follow, shower issue → linked Fix | Guest follow-up is NOT a separately verified callback |
| Shift Handover | Actual handover page and operational state machine | Urgent New → Follow after published note | Does not prove the receiving employee acknowledged |
| Maintenance | Actual Fix workflow Open → Working → Done → Verified | Verified status + source/link readback; transactional SQLite real service tests | **Final Verify is Manager/Owner (make_decisions), not a Lead/Supervisor action** |
| Requests | Actual Draft → Review backend | Checks linked source Approval with Pending status and correct department | Training stops before authorized Approval decision/planning |
| Guest ↔ Fix | Reciprocal canonical links and auto-closure match backend | Real SQLite test creates linked fix, starts, finishes, verifies; UI trainer expects guest **Done** after verification | Current Guest UI creates Fix in **same guest department**; does not automatically transfer to Maintenance |
| Staff | Same permission-backed module visibility | Read-only tours, 117 situation assessments, and authenticated task inspection: find a fictional task in the real Tasks screen, enter its status/priority, verify both against a fresh scoped backend read | Ordinary staff still cannot create/edit/transition records; inspection is learning evidence, not proof of opening a card or a signed certification |
| 117 situation cards | Fictional problem-solving and text/decision rubric | Choice, notes, owner and follow-up validation | Only six cards have complete saved-record workflow checkpoints; scenario text checks are not proof of real execution |

## Important parity corrections

1. The backend `verify_fix()` completes the linked `GuestNote` in the same transaction. The training checker now demands `Guest.status == Done` at final verification, while requiring `Follow` before that.
2. The backend requires `make_decisions` to verify. Full maintenance verification exercises now require that permission before starting and resuming; Leads/Supervisors may still use their authorized training tours.
3. `submit_request()` creates a source-linked `Approval(status=Pending)` scoped to the same department. The training checker now verifies this related record, not just `Request.status=Review`.
4. A linked Fix inherits the guest's department through the current Guest Matters button; only authorized callers using the underlying API and appropriate memberships may explicitly target another department. **Do not describe same-department linkage as a completed cross-department handoff.**

## Staff-safe authenticated record investigation

- Two training-only read-only exercises are now available to ordinary staff and supervisory roles: **Task investigation** and **Shift Handover investigation**. Each chooses a fictional saved record in the trainee's authorized department, opens the existing real Operations screen in a separate tab, and checks the trainee's entered **status plus task priority / handover urgency** against a fresh authenticated backend GET. Neither exercise writes or changes the saved record.
- A wrong answer does not earn completion. The backend still denies staff edits and cross-department reads for both Tasks and Shift Handover; separate SQLite service permission tests cover these invariants. The browser test proves the drill does not submit any write request.
- The exercise remembers its task across navigation, resets safely when the workspace department changes, and retains a local completion timestamp. Completed task/handover inspection rows appear in the same export as scenario and saved-record exercises, with separate **read-only-task-inspection** and **read-only-handover-inspection** record types. This is **read-only record literacy**, not a seventh saved-record mutation workflow, and does not certify that the trainee actually clicked the card; the UI test explicitly opens the real Tasks page.

## Guest Matters and Maintenance staff reading practice

- Added **Guest Matter** status/urgency investigation for the fictional **Front Desk and Café** workspaces and **Maintenance work order** status/urgency investigation for the **Maintenance** workspace. Other departments do not see irrelevant exercises.
- Employees inspect saved training records in the existing real Operations `/guests` and `/fixes` interfaces and return to select the observed saved values; verification uses a fresh authenticated GET and rejects changed, missing, inaccessible or cross-department records. Existing Operations UIs, backend permissions and live workflows remain unchanged.
- Four distinct read-only observation exercises are available where relevant: **Tasks, Shift Handover, Guest Matters and Maintenance**. The completion export distinguishes `read-only-task-inspection`, `read-only-handover-inspection`, `read-only-guest-inspection` and `read-only-fix-inspection`; these are evidence of matching saved data, **not proof the trainee opened the other tab** or actually performed any operational work.
- UI tests exercise the actual saved Guest Matters and Maintenance screens, reject incorrect status and urgency choices, assert staff cannot mutate, and confirm separate CSV evidence. SQLite permission tests verify own-department reads, denied edits and denied cross-department reads.

## Staff-scope notification actions and upgrade preservation

- Every first-time fictional training account now receives **two personal unread notices** (`training_practice_read`) without a cross-department source reference. The earlier 12 arbitrary source-linked notifications could be hidden from their recipients by correct source authorization checks. The new samples retain normal privacy boundaries: only the recipient may see or mark each one read.
- The real Notifications page's **Mark read** action is the first deliberate staff-permitted saved-state exercise: the trainee must locate the exact notice, mark it read, and have the guide confirm its current `read_at` through an authenticated local API GET. The notice remains readable; the lesson explicitly distinguishes acknowledgement from approval or completion of underlying work.
- Startup on **Mac and Windows** idempotently ensures missing fictional notice drills exist in an already initialized local training installation, without deleting the SQLite database, changing credentials, or wiping completed exercises. The repair is restricted to this launcher-validated local training directory, a private fictional roster, and training-only user identities.
- The report exports this evidence as `staff-notification-read`, separate from read-only record investigation and the six manager/lead workflow exercises. This is still **device-local learning evidence**, not an identity-attested certification.
- Automated gates: a browser test uses the real Notifications UI controls and API reads; the packaged Mac and Windows backend smoke calls authenticated read/write/read-back as a staff account; Mac tests reinitialize after removing one synthetic sample to verify idempotent recovery; a SQLite permission test denies another employee's alert and hides cross-department linked source data.

## Evidence and acceptance gates

- Existing `frontend/e2e/real-workflow-training.spec.ts` exercises the actual UI components with a mocked API (fast UI regression). It is **not sufficient by itself** to establish backend parity.
- Added `backend/tests/test_training_real_sqlite_parity.py` executes actual domain service functions in a fresh, in-memory SQLite schema: guest→fix creation and auto-closure, lead denial, department scope, request→approval link, task and handover state transitions. It never touches production or credentials.
- `.github/workflows/interactive-training-smoke.yml` rejects accidental deviations from `main` in core Operations module pages/backend source. The Maintenance page has one deliberate permission-button correction described below; all other listed source files must match.
- Existing native Mac/Windows smoke tests check packaged frontend/backend startup, fiction-only SQLite and manager/staff sign-in; macOS Gatekeeper notarization and hands-on real device installation remain unverified.

**Release checklist:** full Verify including SQLite integration; focused training browser regression; security; Mac ARM64/Intel; Windows; native packaging; followed by actual Mac and Windows installer walkthrough, local DB restart and CSV export. Do not merge or distribute to unassisted nontechnical staff until all gates are passed.

**UI permission correction in this PR (not yet on deployed production):** The original Maintenance page exposes Verify/Reopen to Leads who lack `make_decisions`, resulting in a backend 403. This PR intentionally adds a `canVerifyWork` UI guard to the shared Maintenance page and a role-scoped browser regression. Thus, the training branch is intentionally one permission-control change ahead of `main` until merged and deployed. Live VPS behavior is not claimed to have been corrected.
