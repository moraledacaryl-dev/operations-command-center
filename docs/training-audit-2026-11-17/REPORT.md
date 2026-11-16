# Training follow-up — 17 November 2026

## Scope and limits

Based on current `main` and deployed Operations `d2c8719b9aebfd507c338dce4e6eb6f5d8bbaec3`, with changes in this branch. Desktop browser tests use the same application components and real backend with a separate fictional SQLite database. No real guest, employee, payroll or Operations record was changed. The user previously said phone testing was unnecessary; it is not claimed here.

These are simulated, scripted users; correct answers are known to the scripts. They demonstrate that the exercised path can be completed, not that inexperienced staff have learned or retained it. The real-app mappings below are a working inventory with explicit gaps, not a claim that every button, role and error has been exhaustively checked.

## Role coverage

| Role | Current demonstration | Remaining competency evidence |
|---|---|---|
| Front Desk | Two fictional receptionists completed the assigned course, including saved check-in and checkout practice. | Corrections, exceptional arrivals and independent transfer need more coverage. |
| Housekeeping | Two fictional employees completed their assigned course and read handovers. | Complete cleaning, inspection, late departure and handover variations need explicit evidence. |
| Maintenance | Fictional technician completed the assigned staff course. | Staff reporting/escalation and repair workflow permissions in varying situations need more tests. |
| Café | Two fictional café staff completed their assigned courses. | Drink complaint and follow-up judgment need independent evidence. |
| Kitchen | Fictional kitchen staff completed the assigned course. | Allergy and unsafe-food escalation need independent evidence. |
| Bar | Fictional bartender completed the assigned course and saved the Bar report exercise. | Additional equipment and stock variations need independent evidence. |
| Security | Fictional guard completed the assigned course. | Unsafe-condition escalation and unresolved shift handover need independent evidence. |
| Marketing | Fictional staff completed the assigned course. Earlier isolated tests created a Café-and-Bar campaign and checked filters. | The staff course has limited Marketing-specific saved-work practice; approval and independent campaign work remain partial. |
| Supervisors and leads | Eight fictional department leads/supervisors completed their assigned courses with scoped permissions; earned progress was carried between test segments. | Assigning, changing an assignee, rejection and difficult handovers need broader independent tests. |
| Management and administration | Fictional manager, owner and administrator completed their assigned courses; the account lesson did not alter accounts. Earned progress was carried between test segments. | Independent Marketing, approval, account recovery and exceptional decisions remain partial. |

## Lesson-to-Operations inventory

The course is selected by department and capabilities; actual backend permissions are authoritative. Guided examples sometimes cancel a form deliberately before a separate fictional saved-work exercise. “Partial” means the exercise does not establish all aspects of the real task, even when its scripted course completes.

| Lesson and intended role | Real screen and required operation | Training evidence and limitation |
|---|---|---|
| Getting around — all | Today `/`, My Work `/my-work`, notifications `/notifications`; read assignments and messages. | Guided navigation and two independent navigation checks; partial for interpreting a real task. |
| Reading a shift handover — all | `/shift`; select Urgent or shift, open and read a saved handover. | Staff answer questions against saved fictional notes; other roles use a guided tour. Partial for actual shift handover judgment. |
| Rooms and guest information — all | `/rooms`; search a room, open details, check visible concerns and repairs. | Front Desk reads saved practice reports; other staff practise filters. Access varies by team. Partial for duplicate detection and judgment. |
| Arrivals, departures and room cleaning — Front Desk/Housekeeping | `/housekeeping`; Front Desk records stays using `/rooms/{id}/check-in` and the relevant checkout/correction routes. Cleaning and inspection use turnover routes and permissions. | Front Desk exercise checks separately saved stays. Housekeeping tour and quiz distinguish plans from recorded stays; full cleaning/inspection and corrections are partial. |
| Understanding assigned tasks — all | `/my-work`; read assigned tasks, due dates and statuses. | Navigation and explanatory questions; partial for independently responding to a blocked or reassigned task. |
| Reading repair status — Maintenance staff | `/fixes`; filter urgent work, open an order and interpret its status. | Practice checks opening and returning to Active, not the employee's understanding of the status. |
| Creating and managing a task — department managers | `/tasks`; search, create title, priority and assignee; authorized transitions are under `/workflow/tasks/...`. | Saved fictional task and status checks. Authorization and the assigned department remain server-controlled. Partial for reassignment and failed saves. |
| Recording a guest issue — department managers | `/guests`; search, choose type and urgency, enter a title and context, save and follow up. | Saved fictional guest matter and follow-up. Partial: keyword checks cannot reliably understand every written sentence. |
| Reporting and verifying maintenance — department managers | `/fixes`; enter work item, urgency, technician and problem; authorized `/workflow/fixes/...` transitions include start, done and verify. | Saved fictional repair stages checked; final verification is permission-restricted. Partial for unusual faults and correction. |
| Requesting something for work — department managers | `/requests`; create title, type, priority and reason, then submit for approval. | Saved fictional request and pending review checked; approval is not proof of purchase. Rejection/correction remains partial. |
| Writing a shift note — department managers | `/shift`; publish title, category, priority and details, then carry unresolved work forward. | Saved note and status checked; partial for judgment on the content. |
| Planning a project — department managers | `/projects`; open project form, inspect status and details; project task creation calls the linked-task route. | Lesson inspects and cancels the form; independent check covers navigation. Earlier isolated browser test saved a linked project task separately. Project creation is not demonstrated by this lesson. |
| Bar reports and handovers — Bar members | `/bar`; Report a problem, enter title/type/next-shift details and save. Authorized leads can create an assigned task from the saved report. | Saved fictional low-stock report checked; separate isolated report-to-lead-assignment-to-My Work test passed. Partial for equipment and escalation variations. |
| Preparing a marketing post — authorized Marketing/management | `/posts` and `/posts/editor`; filter areas/status, inspect post and image feedback controls. | Tour and independent area selection; earlier isolated campaign test covered Café and Bar filters. Saved post creation, image edits and review are not independently established by this lesson. |
| Review and approval decisions — authorized decision makers | `/review` and `/approvals`; inspect details, approve or reject with an appropriate reason where required. | Questions and navigation, not a saved independent decision. Clarification is a request to the requester; it is not an invented app button. |
| Managing staff accounts — account managers | `/admin/users`; search, choose role/departments and manage access. | Read-only tour; no real accounts or passwords altered. Reset and recovery procedures are not independently demonstrated. |

## Confirmed observations and changes

- At 1440 × 900, a new Security trainee's first lesson had more text below the panel than was visible, while the next button was below the fold. The new scroll cue appears only while more lesson content is below the visible area. It does not let the trainee skip reading or alter progress.
- The handover and Maintenance tours targeted Urgent using its second position. They now target the named tab, and a test deliberately reorders the tabs before the employee chooses Urgent.
- The first lesson referred to a “dashboard” although the actual page is called Today. That and selected “workflow” instructions now use the page name and concrete actions.
- Some older scenario identifiers have the form `DEMO-ROOM-...`; they are practice codes, not room numbers. The exercise now labels them as codes and explicitly distinguishes them from room numbers, without changing identifiers used by older saved answers.
- Encrypted offline backups now also carry validated completed scenario exercises and unfinished scenario drafts. Existing destination entries take precedence; invalid recognized scenarios are rejected rather than silently dropped. A storage failure attempts to restore the previous entries. Old encrypted reports still open. New backups use a new format so an older app will reject them instead of silently ignoring scenarios; both computers need this update. This does **not** transfer the fictional database, room stays, saved tasks, or interrupted saved-record workflows; those exercises still need repeating on another device.

The final desktop first lesson and first question were captured using a fresh fictional Security login: [lesson](security-first-lesson.png) and [question](security-first-question.png). The scroll cue is visible in the first image. These are screenshots of fictional data, not evidence of human learning.

The 11 staff courses passed on the lesson and layout build before the final backup-format-only adjustment. The first nine lessons for 11 lead and management accounts passed, followed by three manager/owner/admin continuation segments and 11 final segments; those segments used progress earned in the preceding tests. One older administrator test initially stalled because its scripted answer was for the old Marketing question. Updating the test script to the actual current question allowed the rerun to pass; the application was not changed to make it pass. The final segments were also repeated on the later lesson and layout build.

On the lesson and layout build, 52 broader desktop browser tests passed; 39 focused backup/course/spotlight tests were rerun after the backup-format adjustment. TypeScript and the standalone training build passed; lint had four existing warnings. A parallel TypeScript run during a Next.js rebuild failed because generated `.next/types` files were temporarily being replaced; the sequential rerun passed. A full staff rerun reported 11 passing but its trace-enabled process did not exit cleanly and was interrupted; it is not counted as a clean run. A separate trace-disabled rerun passed all 11 and exited normally. Some tests mock API responses; the role courses use the isolated real backend.

## Historical Operations integration findings

A read-only check found exactly the same four approved historical delivery exceptions: four missing Review links, zero missing Inbox links and zero unprocessed deliveries. No candidate Review was found for those entries. [Issue #185](https://github.com/moraledacaryl-dev/operations-command-center/issues/185) records the owner's prior approval of a historical exception, with incomplete deletion evidence. This does not authorize deleting, fabricating or replaying records, nor prove the original cause. The strict audit remains `investigate`.

## Remaining work

The offline transfer still needs a safe, non-destructive design for actual saved records, related record IDs and independently generated fictional accounts. The matrix and scenarios above retain material gaps. Signing requires the owner's certificates and payment/identity verification; see [signing setup](SIGNING.md). No source-code review or automated run establishes actual human learning or perfect reliability.
