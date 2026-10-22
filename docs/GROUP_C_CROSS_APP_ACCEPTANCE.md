# Group C: Cross-application Operations receiver acceptance

This certificate separates **source contract tests**, **producer outbox
observations**, and **actual business-event lineage**. None is a substitute
for the other two. Group B's four September 10 historical certification rows
remain strict structural findings until an explicitly approved disposition;
this procedure does not delete, replay, repair, or waive them.

## A. Source contract acceptance (CI)

Run `pytest -q tests/test_group_c_four_source_receiver.py` from
`backend/`. This exercises **every currently accepted v2 event type** for
Accounting, POS, Staff/Payroll and Inventory using synthetic SQLite
transactions. It tests all three atomic receipt links, identity
isolation, duplicate replay without overwriting a human Review decision,
wrong-source credential rejection, privacy of payload/summary, and rollback
when a matching Review already exists.

**Interpretation:** Green means the checked-in receiver can handle those
messages in isolation. It does **not** establish producer deployment,
worker status, source outbox completeness, real event mappings, matching
credentials, or production event coverage.

## B. Receiver-side read-only evidence

Run after confirming a gated Operations deployment on the actual VPS:

```bash
sudo bash -c '
  set -a
  source /etc/hiddenoasis/operations.env
  set +a
  cd /opt/operations-command-center/current/backend
  PYTHONPATH=. .venv/bin/python -m scripts.audit_integration_deliveries \
    --hours 168 --receiver-credentials
'
```

This intentionally omits per-event diagnostics, financial payloads, private
business narratives, and credentials. Preserve output under restricted
access. Any nonzero `missing_review`, `missing_inbox`, or
`unprocessed_deliveries` is **investigate**, regardless of synthetic-looking
event IDs. A source with zero recent events is **not** automatically broken.

## C. Four producer read-only evidence snapshots

Verify the actual installed worker, not merely its template service name.
Record each source's installed revision, Operations destination enabled and
key configured (booleans only), worker health, and **Operations-destination
only** outbox breakdown and event timestamps. Use each source's approved
read-only endpoint or database access in a transaction that prohibits writes;
do **not** run the worker or manually enqueue source events.

| Producer | Worker template | Outbox scope and terminal state |
| --- | --- | --- |
| Accounting | `accounting-operations-outbox` | `operations_outbox_events`: `delivered`; inspect `pending`, `retry`, `processing`, `dead` |
| POS | `pos-sync-worker` | Sync outbox `event_type LIKE 'operations.v2.%'`; `synced` vs `operations_pending`, `operations_retry`, `operations_blocked`, `suppressed` |
| Staff/Payroll | `hiddenoasis-staff-integration-worker` | `integration_outbox` filtered `destination='operations'`; `Completed` vs `Pending`, `Retry`, `Dead Letter` |
| Inventory | `hiddenoasis-inventory-worker` | `integration_events` or deployed model's actual table, filtered `direction='outbound'` and `destination_system='operations'`; `completed` vs `pending`, `failed`, `processing`, `dead_letter` |

Field/table labels must be verified against the **deployed** revision
before querying. Check that credential presence and destination point to the
intended Operations v2 endpoint, without printing either value. A delivered
outbox state is an **acknowledgment**, not proof that a corresponding Review
still exists.

## D. End-to-end lineage and decision

For any naturally occurring, approved, *non-financial* operational event
available in the chosen time window, compare the producer's stable
`event_id` with Operations
`IntegrationDelivery(source_app,event_id)`,
`IntegrationEventInbox(source_app,external_event_id)` and
`ExternalReviewItem(external_source,external_id)`.

Do not compare independently generated database row IDs. Check exact source
identity and event type. Review status may legitimately be Seen/Rejected/
Completed and must not be reset on replay. No matching business event means
**insufficient live proof**, not automatic failure. Do not generate
transactions or payroll/stock changes for testing.

Acceptance evidence: per-source timestamped configuration and queue
snapshots; at least one authorized end-to-end example with 1/1/1 lineage
for the producing app and no duplicate Review; unresolved outbox errors
triaged. Record only counts and truncated nonreversible identifiers in
ordinary tickets. Keep employee, guest, bank and financial details in the
restricted source system.

**Pass rule:** Four producer source-side checks and exact linked receiver
evidence must be established. If not, Group C remains pending; green CI
alone is insufficient.
