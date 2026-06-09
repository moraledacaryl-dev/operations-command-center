# Hidden Oasis End-to-End Scenario Tests

Date: 2026-06-09

Operations is the manager command layer. These scenarios assume Accounting, POS, Operations, and Staff/Payroll keep separate logins and databases.

| Scenario | Steps | Expected Result | Actual Result | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| POS sale to Accounting | Finalize POS order, sync to Accounting, replay event | Accounting creates one review/import item and duplicate replay is idempotent | Accounting and POS contracts/code exist; live replay not executed in this shell | Partial | Requires deployed POS and Accounting credentials/data |
| POS refund | Refund paid order, sync refund | Accounting creates outgoing cashflow/review item without duplicate replay | Contract exists; live replay not executed | Partial | Needs live POS sample order |
| POS void/reversal | Void finalized order, sync reversal | Accounting marks sale voided once and preserves audit trail | Contract exists; live replay not executed | Partial | Needs live order fixture |
| Drawer/session reconciliation | Close POS register session | Accounting receives reconciliation context; Operations shows variance alert if nonzero | POS daily context includes drawer variance; live cross-post not executed | Partial | Needs deployed POS route and Operations key |
| Room charge | Pay by room charge | POS keeps pending front-desk post; Operations shows pending room charges | POS context includes pending room charge count | Partial | Browser workflow not run |
| Attendance and OT | Create time log exception and pending OT in Staff/Payroll | Operations receives safe counts/cards only | Staff tests pass count-only snapshot behavior | Pass for local unit logic | Live POST needs server key |
| Leave request | Create pending leave request | Operations can show/route review without computing payroll | Contract covered; live workflow not executed | Partial | Needs Staff sample data |
| Cash advance from drawer | Release cash advance and enqueue Accounting event | Accounting preview is Dr employee receivable / Cr cash source | Staff payload and Accounting receiver compile; Staff unit coverage passes repayment/release related logic | Partial | Live Accounting import not executed |
| Payroll cutoff | Compute, QA, approve/pay/lock payroll | Staff owns computation; Accounting receives review-only payload; Operations receives status only | Staff unit tests pass payroll contribution payload and locked/status coverage | Partial | Full browser workflow not run |
| 13th month | Pay 13th month run | Accounting preview is Dr 13th Month Pay Expense / Cr cash/payable | Accounting receiver compile check passed | Partial | Needs live sample run |
| Annual review | Send annual review due event | Operations stores safe status only, no review content | Operations scrubber exists; live event not executed | Partial | Needs Staff event fixture |
| Department request to PR/PO | Create Operations request, route to Accounting PR/PO | Operations shows pending PR/PO statuses without owning Accounting records | Operations status event contract exists | Partial | Needs Accounting PR/PO workflow data |
| Employee sync | Send employee sync to Accounting/Operations | Safe identity fields only; no pay/rates/government IDs | Staff unit tests pass safe employee sync; Accounting scrub compile check passed | Pass for local unit logic | Live POST still needs real key |
| Failed integration retry | Simulate receiver unavailable, retry later | Staff outbox marks Error, retries without duplicate receiver records | Staff direct-post tests pass status/attempt updates and destination filtering | Pass for local unit logic | Live receiver unavailable case not executed |
| Launcher routing | Open root and all four subdomains | Root static launcher; each app retains own login | Static launcher and nginx templates prepared; live root not switched | Partial | Root stays Accounting until Accounting subdomain is verified |
