# Training and Operations audit — 13 November 2026

## Status: incomplete; do not treat as rollout acceptance

This is an evidence log for work performed, not a claim that every course has been completed. Full first-time end-to-end walks, independent transfer for every role, existing-install upgrades, Windows launch, accessibility, and real employee testing remain outstanding. In particular, simulated operation does not demonstrate employee learning or retention. No production business data was changed.

## Versions and environment

- Fetched `main`: `7b80cc86afc513e7636229875335bc8b5422d570`; includes PRs 251, 252 and 253.
- Live server inspected read-only: release `199ea5b3d6a6787bf55f484210bc22a3263bdf27`. It is behind this source. Live authenticated screens could not be checked because the available session was at the temporary-password screen. Opening `/login` provided a way back, but did not demonstrate server-side logout.
- Installed Mac application: full build SHA unknown; bundled demo-seed file matches PR 252 and differs from PR 253. This identifies that component, not the complete executable. Migration `0017_password_change_required.py` is present in the bundle. The app executable is ad-hoc signed; `spctl` returned a Code Signing subsystem error. A real launch, notarization assessment and upgrade of a copy of an existing database were not established by these inspections.
- Local test used a separately seeded loopback-only SQLite database and latest source, not the installed executable or the live database. Windows installation and launch were not tested. No phone testing was performed, following the owner's earlier preference.

## Verified demonstrations

- 22 fictional accounts signed in through the browser, with their assigned departments, and started orientation without a forced password change. This did not complete their courses.
- 22 role-specific decision exercises were answered and remained recorded after reload. The prerequisite course state was deliberately staged and hints were disabled; this is not evidence of completing the course or learning independently.
- Eleven ordinary staff completed guided and independent handover reading against saved fictional handovers. Course progress was staged at that mission; the exercise checks a saved status, and does not itself write a business record. It is not a full course walkthrough.
- A Bar employee who had last selected Kitchen was unable to see the Bar example. The modified component switches back to the primary department when practice starts, offers an explicit recovery button if it changes, and pauses advancement while it is wrong. The previously failing isolated-browser reproduction and ten simulated role checks passed after the fix. [After-switch screenshot](bar-handover-after.png); [completed example](bar-handover-complete.png).
- The real local API smoke exercised all 22 fictional identities, department-scoped task access and denied cross-department access for scoped roles. With fictional data it created and re-read guest, repair, task, handover and approval records, tested status transitions and verified an employee's notification acknowledgement. The script's console says “packaged” and “20” in a legacy label; this run used source code and 22 accounts, not a packaged app.
- Backend password, progress/upgrade and practical-mission tests: 12 passed. These are automated checks against test data, not proof that the installed app upgrades successfully.
- Rebuilt frontend: typecheck and lint passed (four existing lint warnings); ten mocked handover browser regressions and two sign-out browser checks passed. Sign-out UI tests mock the logout response; the backend session invalidation is checked separately.
- In the actual local challenge, the Bar employee could not select the required Bar team. After fixing the options, eight staff roles each opened their challenge and selected the correct team; nine shift-assessment regression checks passed. These checks did not finish the challenges.

## Training-to-Operations mapping (initial inventory)

The table describes what the current source implements and what the training says it checks. It is not a completed audit of every control, permission, scenario or rendered screen. “Partial” means the specific complete journey or transfer has not been demonstrated.

| Lesson | Production page and intended skill | Evidence and important limitation |
|---|---|---|
| Getting around | `/`, `/my-work`, `/notifications`: find work and updates | Partial: all 22 started the lesson; full journey and understanding not demonstrated. Checks navigation. |
| Reading a shift handover | `/shift`: filter and read saved notes | Partial: 11 staff completed the staged mission against saved records. Multi-department visibility fixed. Trainer still needs to confirm understanding. |
| Rooms and guest information | `/rooms`: find named rooms and existing reports | Partial: independently checks two filters, not interpretation or duplicate prevention. Changed “room number” to “room name.” |
| Arrivals, departures and room cleaning | `/housekeeping`: distinguish a plan from recorded status | Partial: independent check searches and refreshes; Front Desk has additional saved exercises. Full permission and end-to-end save audit outstanding. |
| Understanding assigned tasks | `/my-work`: read assigned work, due date and status | Partial: checks navigation; no independent judgment proof. |
| Reading repair status | `/fixes`: open repair and identify status | Partial: source checks opening a repair and returning to Active; understanding requires a trainer. |
| Creating and managing a task | `/tasks`: authorized task creation and follow-up | Partial: local API write and transitions passed; guided and independent complete UI workflows and all role permissions not yet demonstrated. |
| Guest matters | `/guests`: authorized guest concern and follow-up | Partial: local API created a concern and linked repair; end-to-end UI and all role permissions remain unverified. |
| Maintenance | `/fixes`: report and advance repairs | Partial: local API transitions and linked guest closure passed; actual course journey and UI permissions remain unverified. |
| Requests | `/requests`: create and submit request for approval | Partial: local API saved and submitted an approval; UI journey and rejection recovery remain unverified. |
| Writing a shift handover | `/shift`: authorized note and follow-up | Partial: local API saved and transitioned a note; full UI journey and recovery remain unverified. |
| Planning a project | `/projects`: understand project form and filters | Partial: the independent check only changes filters; it does not prove project creation. Corrected help text that implied creation. |
| Bar reports and handovers | `/bar`: report a bar problem and read follow-up | Partial: source has a saved-record exercise as well as a short unsaved form check; actual full workflow and supervisor assignment still need demonstration. |
| Marketing | `/posts`, `/posts/editor`: filter, review and edit | Partial: source describes combined-area promotions and saving an image version, but full UI creation, saved behavior and transfer have not been demonstrated. |
| Review and approval decisions | `/review`, `/approvals`: read and decide | Partial: checks search/navigation; a trainer must assess actual judgment. |
| Managing staff accounts | `/admin/users`: locate accounts and understand access | Partial: deliberately avoids modifying real accounts; actual authorized admin workflow and recovery unverified. |

Training uses the Operations application components with a training mode, coach, exercises and isolated fictional database. The independent shift challenge has an additional training-only task-comment form: ordinary staff cannot access that form on the current live My Work page. A disclosure was added to explain that staff should tell their lead, who can record the update in Shift Handover. Real-app transfer for this action is therefore **not demonstrated**.

## Role coverage — conservative status

All rows are **partial**, not a certification of competence. Assigned course content is capability- and department-dependent; account membership must be checked rather than assumed.

| Role or team | Evidence so far | Still needed |
|---|---|---|
| Front Desk | Sign-in, orientation start, role-specific decision, handover reading; local API guest/repair flow | Full course, arrival/departure recording and corrections, follow-up, independent scenario and transfer. |
| Housekeeping | Sign-in, orientation start, decision and handover reading | Full course, scheduled versus recorded occupancy, post-checkout cleaning and inspection, escalation and saved UI evidence. |
| Maintenance | Sign-in, decision and handover reading; saved local API repair transitions | Actual staff UI permission and complete repair, safety, verification and handover exercises. |
| Café and Kitchen | Sign-in, role-specific decisions and handover reading | Complete courses, complaint and allergy escalation, role-specific saved work, mistake recovery. |
| Bar | Sign-in, role-specific decision and handover reading; wrong-department recovery tested | Complete saved report and supervisor-assignment journey; independent transfer and shift follow-up. |
| Security | Sign-in, decision and handover reading | Complete course; unsafe-condition escalation, follow-up and handover on real UI. |
| Marketing | Sign-in and role-specific decision | Full course; create and filter combined Café/Bar campaign with isolated saved records, feedback and approvals. |
| Leads and supervisors | Fictional accounts authenticated, scoped API permissions checked | Full course; assignment, monitoring, reassignment and unresolved work. |
| Management and administration | Fictional accounts authenticated; API record and approval workflow checked | Full courses, UI decision/rejection and account administration, ordinary-error recovery. |

## Defect register and residual risks

| Severity | Finding | Action / remaining verification |
|---|---|---|
| High | Password-change screen had no visible sign-out. | Added a sign-out button that calls server logout before clearing local state and navigates to sign-in; errors remain visible and retryable. Backend test confirms session invalidation and that the password-change requirement remains. Not deployed. |
| High | Multi-department handover lesson could hide its required example behind the last-used department. | Reproduced and fixed; tested switching and mid-lesson recovery. Other lessons and modified/deleted example records require further testing. |
| High | Practice challenge includes a task-update form absent from live My Work. | Added explicit disclosure and practical live-app instruction. Real-app execution of an equivalent direct update remains unsupported and must not be marked passed. |
| High | Bar was missing from the required team choices in the Bar independent shift challenge, so the correct answer could not be selected. | Reproduced using a fictional Bar login; now uses the shared department choices. All eight role-specific correct teams were selectable in the isolated running app. |
| Medium | Project help claimed creating a project although the guided example is cancelled. | Corrected help to match the form inspection and cancellation. Independent planning ability is still not verified. |
| Low | Room lesson referred to room numbers although named rooms are used. | Changed to room names. |
| High / unresolved | Course completion and lesson counts cannot establish readiness or independent competence. | Complete each assigned course from a fresh account, verify saved-record evidence, test variations and mistakes, then have real employees attempt representative work. |
| High / unresolved | Live source is older than current main and installed Mac full SHA is unknown. | Verify actual builds and upgrade copies, align versions only with owner authorization, and repeat transfer tests against the version deployed. |
| High / unresolved | Installed Mac signature and reported migration problem are not resolved by source inspection. | Test an isolated upgrade using a copied old database and actual packaged app, investigate signing/notarization separately, and test Windows installer and first launch. Preserve progress. |

## Acceptance results

| Exercise | Result | Reason |
|---|---|---|
| A: new employee completes course | NOT TESTED | Only the beginning and staged missions were completed. |
| B: independent work | PARTIAL | Handover reading and simulated decisions tested; comprehensive independent real saved workflows are not. |
| C: different scenario | PARTIAL | Role-specific scenarios exercised, but transfer to a new real workflow not demonstrated. |
| D: real-app transfer | NOT TESTED | Live session unavailable; isolated production-code workflows partially exercised separately. |
| E: error recovery | PARTIAL | Wrong handover answer and department selection tested; broader error set remains. |
| F: return and retain progress | PARTIAL | Scenario local state survived reload; complete course and existing desktop upgrade not demonstrated. |

No defensible overall numerical before/after score is assigned yet: the coverage needed to weight the five categories has not been demonstrated. Remaining mandatory work includes the full training-to-production matrix and all scenarios, full novice walks and screen recordings, actual staff validation, all requested desktop/tablet layouts and accessibility, and packaged Mac and Windows upgrade/launch checks. The changed branch is an incremental improvement, not an assertion that the acceptance standards are met.
