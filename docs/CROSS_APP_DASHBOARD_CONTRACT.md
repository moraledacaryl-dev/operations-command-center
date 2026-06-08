# Cross-App Dashboard Contract

Operations receives review/status events from separate Hidden Oasis apps. It stores review items and may create local tasks or approvals, but it must not modify source records, compute payroll, edit POS sales, or post journals.

## Accepted Source Apps

- `hidden_oasis_staff_payroll`
- `dedicated_pos_cloud`
- `accounting_program`

`external_source + external_id` is unique and idempotent.

## Staff/Payroll Events

- `staff.operations.snapshot`
- `payroll.ready_for_owner_review`
- `employee.status.changed`
- `attendance.exception.created`
- `ot.review.pending`
- `leave.request.pending`
- `cash_advance.request.pending`
- `payroll.qa.warning`
- `annual_review.due`
- `memo.acknowledgment.pending`

Staff payloads must contain operational status only. Salary, rates, benefits, government IDs, infractions, review notes, and HR notes are not stored.

## Accounting Statuses

- `payroll_import.pending_review`
- `pos_sales_import.pending_review`
- `purchase_request.pending`
- `purchase_order.pending`
- `cash_advance_accounting.pending`
- `drawer_reconciliation.pending`
- `payable.due`
- `receivable.issue`
- `journal_review.pending`

## POS Statuses

- `daily_sales_context`
- `drawer_variance.alert`
- `room_charge.pending_frontdesk_post`
- `refund.review_needed`
- `void.review_needed`
- `open_orders.warning`
- `unpaid_orders.warning`

## Endpoints

- `POST /api/integrations/staff/events`
- `POST /api/integrations/accounting/status`
- `POST /api/integrations/pos/status`
- `GET /api/integrations/overview`
- `POST /api/integrations/review-items/{item_id}/create-task`
- `POST /api/integrations/review-items/{item_id}/mark-seen`
- `POST /api/integrations/review-items/{item_id}/reject`
- `POST /api/integrations/review-items/{item_id}/create-approval`

## Review Behavior

Operations may show status, record a manager note, mark an imported item seen, reject/close an imported item, create a local task, or create a local approval. It may route the user to the source app when a source link is available. It must not directly compute payroll, edit payroll results, edit POS sales/payments, or post Accounting journals.

`ExternalReviewItem` stores `external_source`, `external_id`, `event_type`, `source_app`, `source_record_type`, `source_record_id`, `department_id`, `title`, `summary`, `priority`, `status`, scrubbed `payload_json`, `linked_task_id`, `linked_approval_id`, `created_at`, and `updated_at`.

Duplicate events return `already_applied` and do not overwrite existing review status.

## Outcome Vocabulary

- `accepted`: review item stored.
- `already_applied`: duplicate external event ignored.
- `For Review`: manager has not acted yet.
- `Ready to Post`: Accounting-facing item has been reviewed locally.
- `Posted`: downstream app reports completion.
- `Rejected`: manager rejected local follow-up.
- `Errors`: payload could not be processed.

## Example Staff Snapshot

```json
{
  "external_source": "hidden_oasis_staff_payroll",
  "external_id": "ops-snapshot:2026-06-08",
  "event_type": "staff.operations.snapshot",
  "schema_version": "2026-06-v1",
  "payload": {
    "counts": {
      "staff_on_duty_today": 8,
      "attendance_exceptions": 1,
      "ot_pending": 2,
      "leave_pending": 1,
      "cash_advance_pending": 1,
      "payroll_qa_warnings": 0,
      "payroll_ready_for_owner_review": 1,
      "annual_reviews_due": 2,
      "memo_acknowledgments_pending": 4
    }
  }
}
```

Sensitive keys such as salary, rates, government IDs, private HR notes, annual review content, memo bodies, payroll lines, net pay, and cash advance balances are scrubbed before storage.
