# Front Desk room practice — guided Solace, independent Perch 1

Draft prototype stacked on Training PR #222 via Codex PR #224. This is the **first full task** to evaluate with staff before changing all 117 written cases. Production, PMS, staff accounts, and guest records are outside scope.

## What the employee does

1. Read a short Solace guest-AC example, optionally expand “Show me an example,” then choose “Help me do it.”
2. On the actual `/rooms` page, click **Guest rooms**, type **Solace**, and click **Open Solace**. Each real action advances the one-step guide.
3. On the actual `/rooms/<id>` page, read the seeded **[TRAINING] Solace AC not cooling** guest matter and choose its status.
4. The **Check my answer** action re-fetches that room's memory through the authenticated local training API and compares the **specific saved report**, its room name and its status. A wrong answer shows where to look, without declaring completion.
5. Automatically return to Rooms. Without arrows, find and open **Perch 1** and independently read **[TRAINING] Perch 1 towel request**.
6. Check the status of that second report through the same authenticated API. Only the successful second check emits the completion event for the existing required course, and then the next lesson unlocks.

This read-only exercise does not claim that an employee has created a guest report, fixed an AC, delivered towels, or taken a guest phone call. A trainer must still assess work performance.

## Fixtures

The disposable training seeder uses the following true room *names*: Solace, Cafe Suite, Perch 1, Perch 2, Crown, Grandeur, Skyroom and Twinspire. All guest identities, AC reports, towel requests, status data, and work history are **fabricated for the training app**. No PMS bookings, live operational records or credentials are copied. Other older writing-only situations still use their original case text and need a separate content audit before full rollout.

The Solace issue begins at **Follow** (needs follow-up), and Perch 1 begins at **Open**. These are practice facts, not the status of real guest problems. A new isolated local training database is required to see the new fixture names; **never reset or overwrite an existing trainee's completed installation** to migrate old seed data without an approved preservation mechanism.

## Test and release gate

- Pure checks reject corrupt mission state, unrelated guest reports and incorrect room names.
- Browser test uses the real Rooms and room-detail React pages with fake HTTP responses, tests reload persistence, wrong-answer correction, and verified completion.
- Separate real-backend CI walkthrough signs in as a freshly seeded fictional receptionist and performs both room checks without mocked API or business writes.
- Full Verify, Security Audit, Interactive Training Smoke and native Mac/Windows packaging must all pass for the exact PR head.
- Physical Mac/Windows first-launch and supported device acceptance remain separate gates. Draft PR installers are unsigned.
- Progress is device-local practice history, not a tamper-proof certification. A lesson marker alone never grants live permissions.

The original lesson remains for other roles; this prototype is automatically selected for a normal **Front Desk staff** login during the required `staff-rooms` course. It has a clear single-instruction coach rather than multiple overlapping dialogs.
