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
    --hours 168 --diagnostic-limit 25
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
