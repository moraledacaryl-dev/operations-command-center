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
| Staff | Same permission-backed module visibility | Read-only tours and scenario assessments | Ordinary staff do not have authority to write work items; do not grant fictitious production permissions |
| 117 situation cards | Fictional problem-solving and text/decision rubric | Choice, notes, owner and follow-up validation | Only six cards have complete saved-record workflow checkpoints; scenario text checks are not proof of real execution |

## Important parity corrections

1. The backend `verify_fix()` completes the linked `GuestNote` in the same transaction. The training checker now demands `Guest.status == Done` at final verification, while requiring `Follow` before that.
2. The backend requires `make_decisions` to verify. Full maintenance verification exercises now require that permission before starting and resuming; Leads/Supervisors may still use their authorized training tours.
3. `submit_request()` creates a source-linked `Approval(status=Pending)` scoped to the same department. The training checker now verifies this related record, not just `Request.status=Review`.
4. A linked Fix inherits the guest's department through the current Guest Matters button; only authorized callers using the underlying API and appropriate memberships may explicitly target another department. **Do not describe same-department linkage as a completed cross-department handoff.**

## Evidence and acceptance gates

- Existing `frontend/e2e/real-workflow-training.spec.ts` exercises the actual UI components with a mocked API (fast UI regression). It is **not sufficient by itself** to establish backend parity.
- Added `backend/tests/test_training_real_sqlite_parity.py` executes actual domain service functions in a fresh, in-memory SQLite schema: guest→fix creation and auto-closure, lead denial, department scope, request→approval link, task and handover state transitions. It never touches production or credentials.
- `.github/workflows/interactive-training-smoke.yml` rejects accidental deviations from `main` in core Operations module pages/backend source. The Maintenance page has one deliberate permission-button correction described below; all other listed source files must match.
- Existing native Mac/Windows smoke tests check packaged frontend/backend startup, fiction-only SQLite and manager/staff sign-in; macOS Gatekeeper notarization and hands-on real device installation remain unverified.

**Release checklist:** full Verify including SQLite integration; focused training browser regression; security; Mac ARM64/Intel; Windows; native packaging; followed by actual Mac and Windows installer walkthrough, local DB restart and CSV export. Do not merge or distribute to unassisted nontechnical staff until all gates are passed.

**UI permission correction in this PR (not yet on deployed production):** The original Maintenance page exposes Verify/Reopen to Leads who lack `make_decisions`, resulting in a backend 403. This PR intentionally adds a `canVerifyWork` UI guard to the shared Maintenance page and a role-scoped browser regression. Thus, the training branch is intentionally one permission-control change ahead of `main` until merged and deployed. Live VPS behavior is not claimed to have been corrected.
