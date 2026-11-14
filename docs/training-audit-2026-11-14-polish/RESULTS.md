# Operations and training follow-up

## Source and isolation

Work started from `2de34900d8012112324a8d6ca59c4ced867478ef`, verified as both latest `main` and the active Operations release. Browser walkthroughs used separate fictional accounts and a copied fictional SQLite database on local ports. They did not change the live resort or installed training data.

## Changes and evidence

- **Bar report to task:** a lead can assign a task directly from an unfinished Bar report. The report keeps the link; the task carries the report details and appears in the assignee's My Work. The report shows the task's status and assignee when available, and explains when the linked task is no longer in the active list. The server checks the creator and assignee's access, locks the report during creation, prevents replacement or duplicate creation, and sends the usual assignment notification. A simulated bartender submitted a report, a lead assigned it, and the bartender saw it in My Work; the link survived reload. The bartender was denied assignment through the new endpoint. Backend tests cover wrong-department/inactive assignees, retries, finished or archived reports and unauthorized staff. PostgreSQL concurrent requests have not been independently stress-tested.
- **Existing follow-up permissions:** the generic follow-up task handler did not check task creation permission or permission to edit a source record when linking a task. It now applies both checks. HTTP tests verify that a staff member cannot use the reachable Maintenance follow-up route while an authorized lead can.
- **Project tasks:** the project transition route intercepted `create-task`, causing the real button to return HTTP 422. An explicit route now reaches the existing task creation logic, with authorization. A fictional lead's browser walkthrough reproduced 422 before the fix and saved a linked task afterward. The project details now show the task description as well as its title.
- **Training:** the Bar lesson explains the lead's report-to-task path and distinguishes the demonstration from the low-stock saved exercise. Redundant Bar coach text was removed without hiding its steps. Marketing and management lessons have an additional decision example; these questions do not by themselves prove independent work. The Marketing independent check previously accepted Café when it asked for Pool. A browser regression reproduced the incorrect advance, and the check now requires Pool. Scenario choices explicitly say their labels may differ from real work-page buttons; an approval scenario explains that missing information is requested from the requester while the decision stays pending.

## Tests and limits

- Full backend suite: 883 passed, three skipped; targeted assignment and project route tests passed, including notification deduplication and permission checks. An earlier sandboxed run encountered nine permission errors creating temporary Unix test sockets; those nine passed with the necessary local socket permission.
- Training-style build, TypeScript and lint passed; four prior lint warnings remain. A production-style build was also run separately. After a production build replaced the local training build, a subsequent test attempt showed production sign-in behavior; the test app was rebuilt explicitly in training mode, and the affected checks passed on rerun.
- Forty-nine focused desktop browser tests passed, including the new decision examples and Marketing wrong-area check. The complete fictional bartender course and a manager course were repeated; the latter used predetermined answers and carried earned progress between segments.
- Real-screen tests against the isolated backend passed for the Bar report-to-assignment-to-My Work journey and project task creation. Some other browser tests use mocked API data.

These checks do not prove all workflows are correct or that employees have learned the material. Marketing and management still lack full independently verified saved-work exercises, and the full lesson-to-production matrix and broader recovery testing are unfinished. No 10/10 rating is claimed.
