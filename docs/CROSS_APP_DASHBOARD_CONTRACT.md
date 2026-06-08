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

## Outcome Vocabulary

- `accepted`: review item stored.
- `already_applied`: duplicate external event ignored.
- `For Review`: manager has not acted yet.
- `Ready to Post`: Accounting-facing item has been reviewed locally.
- `Posted`: downstream app reports completion.
- `Rejected`: manager rejected local follow-up.
- `Errors`: payload could not be processed.
