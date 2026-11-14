# Follow-up: training progress and clearer practice steps

## Version and scope

The work is based on `6bf466adff85d1527f13ae2f319f57ca39b9fe0a`, verified as both latest `main` and the active Operations release before changes. Testing used a local training build, a separate fictional database and desktop Chrome. The installed training app and live resort data were not changed by these tests.

## Findings and fixes

- **Bar work missing from results:** the saved record and evidence existed, but the progress parser omitted the `TRN-BAR-` prefix, so the completed exercise was hidden in the results and CSV. A regression test failed on the base version. The parser now shares the reference prefixes used to create practice sessions; existing saved evidence is read without being rewritten. Every supported practical kind has a regression check.
- **Required choices left to guessing:** the saved-work checks required specific urgency values for the guest, repair, request and handover examples, but instructions did not say which values to use. The instructions and orange-arrow prompts now name the actual form label and required value for these fictional exercises. This does not replace judgment about urgency in real work.
- **Partial completion markers:** the course and JSON report read raw local markers without the validation already used by the results screen. They now use the same parser. Missing stages and invalid IDs do not grant a practical step or enter the report; completed course history is not removed. Device-local results are learning records, not tamper-proof certification.
- **Bar navigation and plain language:** a return link to `/bar` was labelled “Open Shift Handover.” It now says “Open Bar.” Several visible references to the training database were changed to plain language, and the Rooms example now explains that an employee must open the room to read guest matters and maintenance history.

## Evidence and limits

- Seven progress-integrity tests passed, including the previously failing Bar result and an export check.
- Forty focused browser/unit checks passed cleanly on the final build, covering course flow, navigation, permissions, saved-work validation and the new malformed-marker case.
- A fictional bartender completed the full assigned course with actual saved work in the isolated backend before the final arrow wording change; the results screen showed one checked saved-work exercise after reload. The script used predetermined answers and does not demonstrate human learning.
- A fictional manager completed the first nine lessons and continued through the handover and project lessons before the final arrow wording change, using earned progress and real saved fictional task, guest, repair, request and handover records.
- Production-style training build, TypeScript and lint passed. Lint retained four existing warnings.

The full training-to-production matrix, remaining error-recovery cases, accessibility and actual staff learning still need independent testing. Some lessons assess navigation rather than independent work; the changes here do not turn those into demonstrated competencies. No 10/10 rating or absence of all possible regressions is claimed.
