# Staff walkthroughs — 14 November 2026

## Scope and limits

These were scripted, simulated employee walkthroughs in an isolated local training application built from `15f91460d817823fe2f3e46f132caed41f215e22` plus the fixes in this branch. The application used a separate fictional SQLite database. No real resort records or the installed app's progress were modified. These tests are not a substitute for watching actual employees learn. Desktop Chrome at 1440 × 900 was used; phone testing was omitted at the owner's earlier request.

The app currently installed for staff is the previous released build. These fixes are not included there until a new build is installed.

## Results

| Journey | Result | Evidence and limitations |
|---|---|---|
| First lesson, all 22 fictional roles | PASS after fixes | Signed in, read, answered an incorrect answer and corrected it, followed the screen guide, completed two independent navigation actions, reloaded, and opened the next lesson. |
| Complete ordinary staff courses | PASS after fixes | Completed all assigned lessons without staging progress for 11 accounts: two Front Desk, two Housekeeping, two Café, and one each in Kitchen, Bar, Maintenance, Marketing and Security. The Front Desk accounts each recorded check-in and checkout in two fictional rooms; the Bar account saved a fictional report and checked it. Tests use scripted correct answers and therefore do not establish human learning. |
| Eight staff shift challenges | PASS with qualification | Read the actual saved handover and job, marked a personal practice notice read, saved a follow-up, checked the saved evidence, and reloaded the result. To reach this separate exercise, course progress was staged as finished. The practice-only comment form does not exist on live My Work; the app discloses that difference. |
| Bar staff and lead | PASS for the tested workflow | Staff saved a fictional equipment report, the lead opened it and created an assigned task, and the staff member saw that task in My Work. The app directs the lead to create the task separately; the task is not automatically linked to the report. Lessons were paused to test this workflow; the lead course was subsequently completed separately. |
| Marketing lead | PASS for the tested workflow | Saved a fictional campaign covering Café and Bar, found it under both area filters, and confirmed it was absent under Pool. Lessons were paused for this check; the lead course was subsequently completed separately. |
| Manager course | PASS after fixes | All 14 assigned lessons were completed from fresh progress on a test build before the final guest-panel and Marketing field fixes. The actual earned browser session was carried between test segments; no lessons were staged as complete. Saved task, guest, repair, request, handover and Bar exercises were checked. The Marketing and Review lessons still rely mainly on navigation and require a trainer to assess judgment. |
| Owner course | PASS after fixes | All 15 assigned lessons, including account access, were completed from fresh progress without changing accounts. The earned session was carried between test segments. |
| Administrator course | PASS after fixes | All 14 assigned lessons, including account access, were completed from fresh progress without changing accounts. The earned session was carried between test segments. |
| Supervisor and department lead courses | PASS after fixes, with qualification | Front Desk supervisor and leads for Housekeeping, Café, Kitchen, Bar, Maintenance, Marketing and Security completed their assigned courses from fresh progress using their actual permissions. Earned sessions were carried between test segments. Marketing required a server fix before its task could save; the Café lead run was restarted after the guest-details timing failure. |
| Real Operations transfer | PARTIAL | The isolated environment runs the shared Operations components and real backend with fictional data, but the authenticated live UI was not walked through for every lesson or role. |
| Returning learner | PARTIAL | Lesson completion and challenge results survived browser reload. A full installed-app upgrade with a real employee's progress was not repeated as part of these simulated courses. |

[Bar saved-work guide](bar-report-practice.png) · [Front Desk saved stays](front-desk-saved-stays.png). Both screenshots show fictional data.

## Confirmed problems and changes

| Finding | Reproduction and result |
|---|---|
| Bar staff could not complete a required saved-report lesson. | The lesson created a practice session for a Bar employee, but the guide only rendered for a department manager. A normal Bar employee reached “save your work” with no guide or Check saved work control. The guide now also allows a user who belongs to the matching Bar department; unrelated staff still cannot open it. The full bartender course and authorization regression passed. |
| Rooms lesson pointed at the wrong button. | The guide said to choose Guest rooms or Shared areas but attached its click listener to the first filter, All spaces. Clicking Guest rooms did not advance the lesson. The guide now points to and names Guest rooms. The complete ordinary-staff courses and a focused browser regression passed. |
| Independent shift challenge could open the wrong team. | A multi-department Bar employee last using Kitchen started the Bar challenge and saw Kitchen handovers. The challenge now selects the primary team when started and provides an explicit switch-back control if the employee changes teams during practice. The previously failing real-data reproduction and a mocked browser regression passed. |
| Guided tour could return to an earlier step after rapid navigation. | During the first-lesson checks, the guide returned to “Read your tasks” after the employee had reached Notifications. A delayed callback from an earlier click could advance an obsolete step. The callback now checks that its step is still current before advancing. All 22 first lessons and focused navigation checks passed after the change. |
| Maintenance assignment offered people who could not see the work. | A manager could select an employee from another team and only discover the mistake when the API rejected the save. The form now uses the same department-visibility rule as Tasks, and the practice asks the manager to choose the Maintenance workspace before assigning the technician. The full manager course and focused permission checks passed. |
| A finished practice could obscure a later lesson, and the lesson controls could appear below the screen. | During the Marketing lesson, the previous Bar practice spotlight remained visible and the guide's Next button was outside the viewport. Finished practice arrows are now hidden until requested, and the lesson panel is kept within the viewport. A browser test reproduced the old positioning failure; the new checks and completed manager course passed. |
| A guest details panel could reopen after it had been closed. | Closing it while a follow-up save was still in progress could be undone by the delayed server response, leaving the next training control blocked. The update now changes the panel only if the same record is still open. A delayed-response browser test reproduced the failure and passed on the combined build. |
| The task practice left required choices unclear. | The saved-work check requires High priority, but the instructions only said to choose a priority. The instructions now specify High and explain the Areas covered choice shown in Marketing. |
| Marketing task and post area fields were rejected at the HTTP boundary. | The Marketing lead selected an area and tried to create a task; the server returned “Unknown field(s) for tasks: marketing_areas.” The allowed-field list now includes the field for tasks and posts, while existing validation and department permissions remain in force. Contract and authorization tests cover the change; the Marketing lead then saved the exercise on the combined build. |
| Request guidance referred to a Close button after the app had closed the details itself. | The guidance now says to close the details only if they remain open. The manager submitted a fictional request and verified its pending approval. |

The Bar practice page remains crowded: the saved-work guide, lesson panel and arrow can occupy much of the screen together. The exercise also uses terms such as “practice database.” These are usability concerns, not proof that the work cannot be completed, and need a careful design pass without hiding necessary instructions.

## Verification and remaining work

- Production-style local training build, TypeScript and lint passed; lint reported four pre-existing warnings.
- An earlier desktop regression run passed 50 checks. On the combined build, Playwright reported 52 passed, but its process did not exit and was interrupted during shutdown (exit 130); this is not counted as a clean complete run. Ten focused guide checks and the separate guest-panel race test passed cleanly on the combined build. Some regression tests use mocked API data; the complete employee and lead workflows above use the isolated real backend.
- Four additional focused Maintenance tests passed, covering eligible assignees, the saved repair exercise, and authorized versus unauthorized verification controls.
- Thirteen backend contract and Marketing authorization tests passed. The earlier direct `pytest` invocation did not find the app package; running the same tests with `python -m pytest` passed.
- Extend mistake and recovery checks beyond those exercised here. Investigate the browser regression runner not exiting cleanly after reporting all 52 tests passed.
- Complete the full lesson-to-production matrix, role competency checklist, tablet layouts, keyboard and screen-reader checks, and retention tests. The prior report identifies additional unverified scenarios and desktop/Windows packaging concerns.
- Have actual staff attempt representative lessons without coaching and use their feedback before declaring readiness. No human retention or 10/10 rating is claimed.
