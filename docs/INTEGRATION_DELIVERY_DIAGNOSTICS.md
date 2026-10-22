# Operations v2 delivery linkage diagnostics

This runbook investigates a processed v2 delivery whose original Inbox or
External Review row is missing. The audit is **read-only** and never replays
an event, reopens a human decision, or repairs historical data.

## Production-safe initial investigation

Confirm the active release SHA and services before interpreting a report.
With the protected production environment already configured, run from the
**active release** (not an arbitrary checkout):

```bash
sudo bash -c '
  set -a
  source /etc/hiddenoasis/operations.env
  set +a
  cd /opt/operations-command-center/current/backend
  PYTHONPATH=. .venv/bin/python -m scripts.audit_integration_deliveries \
    --hours 168 --diagnostic-limit 25 --receiver-credentials
'
```

The ordinary report omits per-event identifiers. The opt-in
`--diagnostic-limit N` section adds at most N anomalous deliveries
(missing Inbox, missing Review, or unprocessed), including delivery ID,
source app, event ID, event type, receive time, processing status, linked
Inbox/Review IDs, and possible alternate Review IDs. **It never prints event
payloads or personal narratives.** Event identifiers can themselves contain
business identifiers, so retain this output only in a restricted incident
record, not public logs or GitHub issues.

The `truncated` field means additional anomalies exist beyond the requested
limit. Increase the limit if necessary; a negative limit is rejected.

`--receiver-credentials` additionally reports which of the four source-specific
receiver credentials are present and whether the Operations configuration is
accepted. No secret values or hashes are printed. A configured receiver key
**does not prove** that the sending application has the correct matching
key or that its worker is active.

An `identity_hint: suspected_connectivity_test` means the source and exact
`connectivity-cert-YYYYMMDDTHHMMSSZ-NNN-source` identifier format match.
The hint is not verified test provenance. It never suppresses a structural
finding or creates/deletes a record.

## How to interpret findings

- Missing Review means no row matches **both** the recorded source app and
  external event ID. It does not prove a human deleted that record.
- A candidate Review with the same event ID or source subject is merely an
  investigation lead. It is **not** evidence that the two are interchangeable.
- A processed delivery with missing links is still reported as structurally
  incomplete. An identical retry now returns HTTP 409 rather than claiming
  `already_applied`. It does **not** recreate the Review.
- No recent v2 deliveries means no v2 events were observed in the selected
  window. It does not prove disconnection, nor does it measure legacy traffic.

For each anomaly, establish whether it is a canary/test or genuine event,
trace its Inbox and any alternate Review, inspect its human decision history,
and document whether a repair is actually required. A closed historical case
must not be turned into a new pending Review by automation.

If repair is justified, preserve backups and audit lineage, use a narrowly
scoped idempotent procedure, and separately review its proposed changes.
Never issue blanket `INSERT` statements for all missing links.

## Source-side follow-up

Inspect the sending app's enabled event types, destination endpoint version,
pending/failed outbox, credential mapping (without printing secrets), and
recent send logs. Use a safe canary event when source and receiver evidence
justify one; do not create financial, payroll, or inventory transactions merely
to exercise this pipeline.

The report's default return code is nonzero on broken structural integrity.
`--require-all-sources` additionally rejects an observation window where
any registered source has no v2 deliveries; use it only when recent activity
is genuinely expected from every producer.


## October 22, 2026 — observed certification-shaped gaps

The read-only production report at 07:11 UTC listed **exactly four** missing
Review links, all with `connectivity-cert-` event IDs dated September 10,
2026, while every corresponding Inbox row remained intact:

| Source | Delivery ID | Event type |
| --- | ---: | --- |
| Accounting | 15 | `budget.variance.alert` |
| POS | 13 | `daily_sales_context` |
| Staff/Payroll | 12 | `staff.operations.snapshot` |
| Inventory | 14 | `inventory.exception.created` |

Each delivery reported `processed`, no matching Review, and no alternative
Review candidate. No v2 deliveries were recorded within the most recent
seven-day window. The common IDs make historical certification cleanup
plausible, but **the operator must verify the original certification activity
and any deletion/audit history before closing this investigation**. This is
not evidence of missing actual sales, ledger entries, payroll or stock.

Do not insert replacement Reviews just to make the structural report green.

## Read-only producer/worker triage

These are the worker names in the **GitHub deployment templates**; the
actual installed names and running configurations must be verified on the
VPS before drawing conclusions:

```bash
for service in \
  accounting-operations-outbox \
  pos-sync-worker \
  hiddenoasis-staff-integration-worker \
  hiddenoasis-inventory-worker
do
  printf '%s: ' "$service"
  systemctl is-active "$service" || true
done
```

Service state alone is not delivery proof. If a template worker is not
installed, first inspect the installed deployment/service naming rather than
blindly creating or starting units.

**Accounting** — The producer uses a durable Operations outbox and the
`accounting-operations-outbox` worker. Check whether
`OPERATIONS_INTEGRATION_ENABLED` is true in
`/etc/hiddenoasis/accounting-backend.env`; confirm the destination base,
source identifier and dedicated key are configured (do not print secrets).
Review the outbox's counts of pending, retry, processing, dead and delivered
events using the application status endpoint or a read-only database query
reviewed against the deployed schema. The default feature flag in source
code is false; that does **not** establish its production value.

**POS** — The `pos-sync-worker` owns v2 operations outbox delivery.
Check `OPERATIONS_INTEGRATION_ENABLED`, the destination and dedicated key
in `/etc/hiddenoasis/pos-backend.env`. Investigate existing
`operations_pending`, `operations_retry`, `operations_blocked`,
`synced`, and `suppressed` records before generating new canaries. The
default feature flag in source code is false.

**Staff/Payroll** — Check
`hiddenoasis-staff-integration-worker` and the installed
`/etc/hiddenoasis/staff-payroll.env` variables
`STAFF_PAYROLL_OPERATIONS_SYNC_URL` and
`STAFF_PAYROLL_OPERATIONS_SYNC_TOKEN`. Inspect Owner-only
`/api/v1/integrations/status` and outbox statuses. The worker translates
Staff envelopes through `core/operations_v2_adapter.py` and has distinct
pending/retry/dead-letter states.

**Inventory** — Check `hiddenoasis-inventory-worker`, and
`INTEGRATION_ENDPOINTS_JSON` (`operations` destination) and
`OPERATIONS_INTEGRATION_KEY` in
`/etc/hiddenoasis/inventory-backend.env`. The stock alert producer queues
alerts only after an endpoint and key are configured, so an empty outbox
alone cannot establish healthy behavior. Inspect queue counts and recent
worker logs without exposing event payloads or credentials.

Do not copy environment-file contents or raw financial/guest/payroll logs
into chat, public issues, or CI artifacts. Report only the service names,
active/inactive states, booleans indicating configuration presence, and
aggregate queue counts. Do not trigger a synthetic financial or payroll
transaction as a connectivity test.

### Evaluation

1. Receiver credential presence/validity: confirm Operations is ready to
   accept each source; this does **not** authenticate a real producer.
2. Worker states: determine whether each installed producer worker is
   active and its Operations destination is enabled/configured.
3. Outbox evidence: find pending, failed, blocked or dead-letter messages,
   plus last attempted and last accepted deliveries, where supported.
4. Only after the prior checks, consider an explicitly labeled safe canary,
   and verify its Inbox, Delivery, and Review without disturbing genuine
   operational issues.

An event-driven source may legitimately emit nothing for seven days; do
not assign an arbitrary daily heartbeat requirement.
