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
| Bar staff and lead | PASS for the tested workflow | Staff saved a fictional equipment report, the lead opened it and created an assigned task, and the staff member saw that task in My Work. The app directs the lead to create the task separately; the task is not automatically linked to the report. Lessons were paused to test this workflow, not completed in full. |
| Marketing lead | PASS for the tested workflow | Saved a fictional campaign covering Café and Bar, found it under both area filters, and confirmed it was absent under Pool. Lessons were paused; this is not a complete lead-course walkthrough. |
| All lead, supervisor, manager, owner and administrator courses | NOT TESTED in full | First lesson and selected workflows were tested; later assigned lessons and full start-to-finish completion remain to be walked through. |
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

The Bar practice page remains crowded: the saved-work guide, lesson panel and arrow can occupy much of the screen together. The exercise also uses terms such as “practice database.” These are usability concerns, not proof that the work cannot be completed, and need a careful design pass without hiding necessary instructions.

## Verification and remaining work

- Production-style local training build, TypeScript and lint passed; lint reported four pre-existing warnings.
- 48 desktop regression tests passed, including progress parsing, role access, handover, Front Desk practice and the new focused checks. Some of those regression tests use mocked API data; the complete employee and lead workflows above use the isolated real backend.
- Continue the complete lead, supervisor, manager, owner and administrator courses from fresh progress; verify their real saved exercises and failure recovery.
- Complete the full lesson-to-production matrix, role competency checklist, tablet layouts, keyboard and screen-reader checks, and retention tests. The prior report identifies additional unverified scenarios and desktop/Windows packaging concerns.
- Have actual staff attempt representative lessons without coaching and use their feedback before declaring readiness. No human retention or 10/10 rating is claimed.
