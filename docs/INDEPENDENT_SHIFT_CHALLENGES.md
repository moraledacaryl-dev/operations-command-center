# Independent shift challenges — employee walkthrough

Seven new challenges extend the existing lessons. A staff member reads a real fictional handover and their own assigned job, reads their personal notice, makes a decision and saves a useful follow-up on the job. Completion checks the saved comment and notice under that employee's own login. There are no arrows by default and no borrowed manager permissions.

PR #224 remains draft, stacked on #222. No merge, deployment or production data changes are authorized or performed. Final committed SHA, checks and installer provenance are delivered with the download's `LATEST_HEAD_CI.json`.

## What the employee does

Open **Hands-on Training → Open your shift challenge** after the compulsory lessons. Each department receives one short, different problem:

| Department | Practice number | Shift problem | Expected response |
| --- | --- | --- | --- |
| Front Desk | SHIFT-FD-01 | Perch 2 has no hot water; the guest is waiting before shift change | Arrange Maintenance inspection and a confirmed guest update |
| Housekeeping | SHIFT-HK-01 | Crown bathroom floor is still wet before arrival | Arrange a dry-floor check and tell Front Desk before room release |
| Café | SHIFT-CAFE-01 | Table 5 has waited for breakfast; no serving time is confirmed | Check with Kitchen and update the guest without guessing a time |
| Kitchen | SHIFT-KT-01 | A dessert's ingredients have not been checked for a nut allergy | Hold the plate, alert the lead and obtain the ingredient check before service |
| Maintenance | SHIFT-MT-01 | A leak is beside an electrical outlet | Restrict access and ask qualified staff to inspect |
| Marketing | SHIFT-MK-01 | A draft shows Friday instead of Saturday | Ask for correction and lead review before scheduling; keep it unpublished |
| Security | SHIFT-SC-01 | Boxes block a fire exit while guests are inside | Alert the lead now, arrange safe clearing and check the escape route |

The employee finds the same practice number in Shift Handover, My Work and Notifications. Optional help explains the menu groups and provides screen links. They read the actual record drawers, then return to the challenge. The form asks for the handover's saved status, urgency, responsible team, next action, responsible role, next check/time and a short note.

The choices use everyday wording, including **Get the lead's help now**, **Ask the right team and follow up**, and **Ask for a correction**. Internal decision values remain compatible with the existing rubric. Empty answers get short instructions; a wrong urgency gets the reason from that actual problem. Error focus scrolls directly to the first invalid control. The challenge sits inside the main page and never covers the Operations controls. The floating lesson button is hidden on this page because help is already part of the challenge.

**Save follow-up on my job** calls the existing authorized task-comment operation and reads the saved record back. It saves a comment of type `Shift follow-up`; it does not assign a task, change a job's status, approve a request, publish a post or claim a repair occurred. Ordinary staff already have permission to comment on records they can access. Shared operational pages and backend business workflow/authorization code were not changed.

**Check shift challenge** requires all of the following:

- The named handover and own assigned job were actually opened in visible record dialogs.
- The handover answer matches the current saved record.
- The employee's own named notice is saved as read.
- The note passes the case-specific checks, with a responsible role and a time or event for the next check.
- The matching comment is saved on that exact assigned task, authored by that employee during the attempt. Another person's comment, another task, or an unsaved text box does not count.

Reading is observed in the browser; record identity, assignment, status, notice and comment are rechecked through the authenticated backend. Browser state is not a signed certificate. The writing rubric cannot establish real-world judgment or prove that a physical action occurred. An employee must write what is still needed rather than claim unconfirmed work is finished.

## Trainer review and existing installations

Leads and managers can open **Hands-on Training → Review shift follow-ups**. This read-only page shows comments from the assigned employees' actual training jobs, with their names and save times. The department choices come from their permitted memberships; normal backend access controls still apply. Viewing a note does not approve work or certify the employee.

The seed adds seven department handovers, one assigned job and one personal notice per fictional staff login. Ten staff logins are supported, including the AM/PM alternatives. The Mac and Windows launchers append missing challenge records to an existing validated private fictional installation. They preserve accounts, job comments, statuses and earlier records. The JSON case catalog is included in both frozen backend packages. The upgrade reuses the existing local-path, environment, private-roster and synthetic-user guards and is idempotent. Production/default-bootstrap configurations are refused before any challenge job is added.

## Actual graphical walkthrough

The primary walkthrough used visible Chrome with the real local backend, not Playwright API mocks. The local database was a private copy of the earlier fictional acceptance database. These staff accounts had genuinely completed their compulsory lessons during the preceding graphical walkthrough. Their existing earned course progress was retained; no lesson was pre-marked, imported or skipped by changing storage. All new challenge attempts began without completion evidence.

Private credentials remained outside the repository and evidence. No screenshot contains a login password. No employee action was performed by direct API call, localStorage manipulation or a hidden route. Each saved note was authored in the form during the walkthrough, independently of the automated model-response fixtures.

| Actual account | Graphical result | Viewport used for the challenge |
| --- | --- | --- |
| reception-pm@training.invalid | Read own handover/job/notice; rejected wrong and incomplete response; refreshed draft; rejected unsaved answer; saved and completed | 1440 × 900 |
| housekeeper-am@training.invalid | Read actual records, rejected wrong urgency, personally wrote room-release follow-up, saved and completed | 1280 × 720 |
| barista-am@training.invalid | Read actual records, rejected unsupported emergency urgency, personally wrote Kitchen/guest update, saved and completed | 768 × 1024 |
| cook@training.invalid | Full challenge on phone; actual handover/job/notice, wrong urgency, optional help, saved hold-and-check follow-up, completed | 390 × 844 |
| technician@training.invalid | Read actual records; wrong slow response rejected; saved restriction/qualified-inspection follow-up; no repair verification attempted | 1440 × 900 |
| marketing-assistant@training.invalid | Full phone challenge; rejected unsupported Critical; saved correction/review follow-up without publishing | 390 × 844 |
| guard@training.invalid | Full small-phone challenge; wrong slow response rejected; saved exit-check follow-up; repeated through real screens; refresh/restart/sign-in verification | 360 × 740 |

Seven distinct staff challenges reached **Shift challenge completed**. Security completed two repeats, including the final plain-English retest: nine completed graphical attempts in total. The preserved manual database contained eight saved comments from seven distinct staff authors and seven read shift notices after the initial seven-role run and Security repeat. Other lessons and earlier comments remained intact. A repeat starts a new attempt while retaining saved job notes.

The manager then read all seven personally written follow-ups through the trainer page. The Front Desk supervisor saw only the assigned Front Desk and Housekeeping department choices and could read Reception's saved follow-up. No approve/verify/certify control is present in this review page. These are two additional graphical role checks, not two additional completed staff challenges.

Representative evidence:

- [Reception completion](shift-challenge-evidence/reception-completed-desktop.jpg)
- [Housekeeping completion](shift-challenge-evidence/housekeeping-completed.jpg)
- [Café tablet completion](shift-challenge-evidence/cafe-completed.jpg)
- [Kitchen phone completion](shift-challenge-evidence/kitchen-completed.jpg)
- [Maintenance completion](shift-challenge-evidence/maintenance-completed.jpg)
- [Marketing phone completion](shift-challenge-evidence/marketing-completed.jpg)
- [Security final phone repeat](shift-challenge-evidence/security-final-repeat-completed.jpg)
- [Final phone error focus and plain choices](shift-challenge-evidence/final-plain-language-phone-feedback.jpg)
- [Manager reads saved records](shift-challenge-evidence/manager-read-saved-followups.jpg)
- [Supervisor department scope](shift-challenge-evidence/supervisor-review-permissions.jpg)
- [Labeled graphical observations](shift-challenge-evidence/browser-observations.json)

This uses every requested viewport size across actual challenge interactions. It does not claim five complete challenge runs for each role. It is an agent-operated employee simulation; no actual resort employee has yet accepted the experience.

## Issues found while operating the first build

| Issue | Account, screen and action | Expected / observed | Cause and correction | Retest |
| --- | --- | --- | --- | --- |
| Notice control mismatch — Major | Reception, Notifications: look for Mark read on SHIFT-FD-01 notice | Named control available / only Open was present | An action URL changes the existing notification control. Seed the challenge notice without that URL, and use the readable category Shift notice | Actual Mark read button appeared, clicked and saved state passed completion. The development preview was reseeded from the private prior-course copy before further challenge writes; no awarded result was erased |
| Empty main landmark — Moderate | Reception: read challenge page and inspect Skip to content destination | Challenge inside main / content above an empty main | Challenge mounted before the route outlet. Move it into the existing main landmark | Revised DOM shows challenge under main; operational pages retain their normal content |
| Long accessible names — Moderate | Reception: use fields after validation errors | Label is concise, hints are separate / hints and errors became part of control names | Wrapped explanatory text contributed to the accessible name. Give controls explicit labels and descriptive associations | Actual browser names are short; hints/errors remain available as descriptions |
| Error focus outside phone view — Moderate | Kitchen, submit Routine and incomplete response at 390 × 844 | First error visible / focus changed but the control remained below the view | Smooth default scrolling and simple focus were insufficient. Focus without implicit scroll, then center the control immediately | Final 360-phone retest: incorrect urgency control at y=346–394 within a 740-pixel viewport; [evidence](shift-challenge-evidence/security-phone-feedback-fixed.jpg) |
| Floating lesson button overlaps form — Moderate | Kitchen phone: scroll to handover status | Label unobstructed / Training pill covered text | Existing floating launcher occupied form space. Hide that launcher only on the new challenge/review pages; keep local help | Final phone retest shows zero visible launcher rectangles and clear controls |
| Repeated long record titles — Minor | Kitchen phone: read instructions for handover/job/notice | Short, scannable task / repeated full titles consumed much of the view | Instructions repeated the case title and code. Use the common practice number to identify all three records | Final repeat used the short instructions to find actual records and complete |
| Technical and mismatched feedback — Moderate | Reception/HK: submit done, someone, later and wrong choices | Helpful plain English / character minimum and Front Desk example appeared for other roles | Generic rubric copy reused verbatim. Use a short note explanation, department-appropriate role example, time prompt and plain decision labels | Actual phone feedback, typed corrections and completed saved notes; focused regression rerun |
| Menu location unclear — Minor | Reception/Kitchen: find Shift Handover in collapsed menu | Optional help identifies location / generic use-the-menu instruction | Help omitted Property/Activity grouping. Name the groups, phone More and bell, with optional screen links | Kitchen and final small-phone repeat used help; no arrows were added |

The initial automated live test also expected a literal Read badge. The existing Notifications UI removes Unread/Mark read after saving instead. The assertion was corrected to observe those actual controls; saved `read_at` is still verified by the challenge. This was a test assertion error, not an application defect.

## Validation and limits

- **Backend:** 818 passed, 3 skipped; includes additive/idempotent challenge upgrade, preservation of saved comments and refusal of unsafe configuration.
- **Full browser suite:** 677 passed, 9 optional live tests skipped, before the last wording/layout refinements.
- **Final affected browser checks:** 19 passed after the final build; these cover challenge rubrics/ownership, course behavior and plain-language training.
- **Real-backend fresh-account acceptance:** 9 passed. Two existing receptionist/manager smoke tests, plus all seven staff accounts completing all four compulsory lessons and then their challenge from a fresh browser context against a separately migrated and freshly seeded fictional database. No API mocks or pre-completed markers. This automated evidence is separate from the primary graphical walkthrough.
- **Frontend lint, TypeScript, production build and standalone packaging:** passed.
- **GitHub checks and Mac/Windows artifacts:** exact final-head results and artifact IDs are recorded in the downloadable `LATEST_HEAD_CI.json`; historical c345add checks are not used for the new source.

[Backend results](shift-challenge-evidence/backend-results.log), [browser results](shift-challenge-evidence/full-browser-results.log), [fresh live tests](shift-challenge-evidence/fresh-live-results.log) and final affected/build logs accompany the evidence.

The remaining acceptance gates are real staff comprehension, real phone/touch behavior, physical Mac/Windows first launch and upgrade, signing/notarization and observation of workplace skills. The challenges exercise actual permitted software actions and saved follow-up, not physical maintenance, food preparation or emergency response. Some written responses can satisfy a rule without demonstrating sound judgment; trainers must read and discuss them. Browser progress remains device-local, while comments/notices are in the private training database. No production release is claimed.
