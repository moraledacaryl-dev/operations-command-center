# Staff Guide and Controlled Policies — Implementation Contract

Status: engineering implementation branch; **not production ready**.

## Existing architecture (verified on main at 64ea4b4)
- `DepartmentDoc` is legacy departmental CRUD with title, department_id, doc_type, body and status; it does **not** represent approved controlled policies.
- `/api/docs` uses generic CRUD and `manage_department`; do not allow this generic write path to publish controlled policies.
- Department visibility uses primary `User.department_id` and `UserDepartment` memberships. Department-null documents are not automatically staff-visible through generic scope.
- Existing notifications are persisted in `foundation.Notification` using `services.notifications.notify_user`; the app polls unread counts.
- Existing authenticated attachment handling can be reused only with document/version-specific authorization.
- Training is a separate interactive workflow. Opening a guide or completing training is **not** acknowledgment.

## Required design
1. **Single authoritative document**: immutable published revisions; drafts editable separately. Preserve legacy docs without auto-publishing. Explicit owner-approved migration/import of legacy content.
2. **Audience**: All Staff, selected department IDs (multi-select), and Manager Only. Resolve effective membership from both primary department and membership rows. Always enforce access in the API and download endpoints; never trust frontend filters.
3. **Lifecycle**: Draft -> In Review -> Approved -> Published -> Retired. Distinguish content editor, reviewer, publisher. Require owner/admin for company-wide and restricted policies, and disallow self-approval of formal policies where policy requires separation.
4. **Content**: title, type (SOP, Policy, Quick Guide, Emergency), category, plain-language summary, ordered steps, escalation contact/role, keywords, images/attachments, related training, effective date, review date. Treat rich text as untrusted; sanitize rendered output and block script-bearing uploads.
5. **Publication**: atomic transaction creates immutable revision, updates current published pointer, creates exactly one notification per affected active employee, and (for required acknowledgment) creates per-employee reading assignment. Never notify on draft upload.
6. **Notifications**: use existing notification bell and My Work. Notify on new published docs and substantive published revisions only, targeted to authorized active staff; dedupe users with multiple memberships. Notification action must point to a server-authorized document detail. No confidential titles leaked across audiences.
7. **Acknowledgment**: `user_id`, `document_revision_id`, `acknowledged_at`, unique pair; never mark acknowledgment from mere view, download or training completion. A new substantive revision creates a new obligation. Provide employee My Reading and manager status reporting.
8. **Reminders**: idempotent scheduled job for overdue/unread mandatory reading, with controlled cadence; do not spam. Audience changes should reconcile pending assignments and visibility without corrupting historical acknowledgments.
9. **Training**: deep links to current published revision, mandatory refresher assignment when specified. Training practice and acknowledgment remain separate records.
10. **UI**: `/staff-guide` in primary navigation, search, department and type filters, What's New, My Reading; manager authoring/review queue; mobile-first short instructions, large clear buttons, empty/error states.
11. **Privacy**: do not place employee-specific disciplinary, payroll, health, or private HR files in general guide. Only approved company-level HR policy text may be published to staff.
12. **Deployment**: additive Alembic migration, populated-data migration test, backup, rollback, existing deployment gate. No automatic seeding of unapproved real policies.

## Acceptance matrix
- Staff A in Bar sees published Bar + All Staff, but not Housekeeping-only or Manager Only.
- Staff B in both Café and Bar receives one notification for shared SOP, not two.
- Drafts/review/approved-but-unpublished documents are invisible to staff and do not notify.
- Manager/lead cannot bypass publication approval by using `/api/docs` or changing status.
- Unauthorized direct document ID and attachment download return 403/404 without metadata leakage.
- Published revision content cannot be mutated; new version keeps historical text and acknowledgment records.
- Reading an SOP does not count as acknowledgment. Explicit acknowledgment is revision-specific and idempotent.
- Company-wide policy update notifies every eligible active staff member once, including those with no department.
- Changes in staff membership, disabled accounts, and multi-department assignments behave consistently.
- Search results and notifications never expose confidential document titles or snippets.
- Mobile: search, open, read, acknowledge, return to My Reading all work on narrow viewport.
- Tests: backend authorization and lifecycle, populated migration, notification dedupe, training links, frontend lint/typecheck/build, browser staff and manager walkthroughs, guarded release smoke.

## Release stages
A. Storage, access policy, immutable revisions, publishing workflow, tests.
B. Staff Guide and manager UI, search, attachments, mobile.
C. Targeted publication notifications, My Reading, acknowledgments, reminders, reports.
D. Training links, full adversarial tests, browser acceptance, guarded production deployment.

Do not merge or deploy until all acceptance tests pass.