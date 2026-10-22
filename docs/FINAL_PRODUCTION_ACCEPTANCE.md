# Operations final production acceptance — read-only evidence

This checklist is for the **latest GitHub-verified release**, after the
production deploy script reports `DEPLOYMENT GATE: PASS`. It does not
replace that deployment gate.

## 1. Identify the exact release

Run the official deploy script with the verified, full 40-character `main`
SHA. Do not treat a merged PR or a green GitHub Action as evidence that
production has changed.

After successful deployment, run the following **read-only** checker on the
VPS. It reads release identity, service status, public health endpoints,
receiver credential validity flags and integration links. It does not
print or hash secrets, modify a database, replay events, restart services,
or change human Review records.

```bash
sudo bash -c '
  set -a
  source /etc/hiddenoasis/operations.env
  set +a
  cd /opt/operations-command-center/current/backend
  PYTHONPATH=. .venv/bin/python -m scripts.certify_operations_readiness \
    --expected-sha INSERT_THE_EXACT_VERIFIED_40_CHARACTER_SHA \
    --hours 168 --diagnostic-limit 25
'
```

The `--expected-sha` must equal the newly deployed `main` SHA, **not**
the prior deployment's SHA. Keep the entire release gate and acceptance
result together with the deployment backup identifier.

## 2. Read the evidence accurately

| Field | Meaning |
| --- | --- |
| `runtime_readiness: pass` | Active immutable release, HTTP liveness/readiness SHAs, readiness flag, two Operations services, receiver credential validity pass |
| `runtime_readiness: fail` | A release, health, service or receiver setting is missing/mismatched; investigate before signing off |
| `integration_delivery.structural_integrity: pass` | No missing delivery Inbox/Review links or unprocessed deliveries observed |
| `integration_delivery.structural_integrity: investigate` | A real structural finding is present, **even if the event ID looks like a test** |
| `all_sources_observed_recently: false` | No recent delivery from one or more event-driven sources; **not automatically an outage** |
| `final_acceptance: requires_human_device_and_workflow_signoff` | Automated infrastructure/structural checks passed; manual proof remains |
| `final_acceptance: requires_manual_integrity_review` | Runtime passed but historical/integration exceptions require investigation |
| `producer_outboxes: not_checked_by_this_read_only_receiver_audit` | Check each producer separately; this checker cannot claim full end-to-end health |

Exit codes: **0** = runtime and delivery-link integrity clear (human
sign-off still required); **1** = runtime/receiver failure; **2** = runtime
passes but structural delivery exceptions need investigation. Code 2 may
therefore be expected for known historical exceptions, and must not be
misrepresented as a clean acceptance.

The tool deliberately outputs only aggregate diagnostic counts and exact
source observation categories. Use the separate restricted
`audit_integration_deliveries --diagnostic-limit` command for sensitive
event IDs if an authorized operator needs them.

## 3. Known historical follow-up (October 22, 2026)

Four `connectivity-cert-`-shaped September 10 deliveries (Accounting,
POS, Staff and Inventory) remain `processed` with their Inbox entries but
no Review links. They have no candidate Reviews in the recorded production
audit. Their event IDs suggest a certification exercise, but that
**does not prove** provenance. Do not fabricate pending issues, delete
deliveries, backfill Reviews, or mark the structural audit green to hide
them. Resolve only after confirming origin and retention history with
human authorization, retaining an audit trail.

Earlier operator evidence: all four producer workers were active, destination
configuration was present, sender/receiver keys matched and 10 outbox events
showed delivered/synced/completed with no outstanding producer queue. These
facts are **point-in-time observations**, not proof of current status or
of end-to-end business semantics.

## 4. Manual production acceptance (do not automate financial mutations)

- Verify desktop and mobile real-session screenshots for owner, manager,
  lead/supervisor and staff, including sidebar, drawers, Project detail,
  Tasks, My Work, Requests, Guest Matters, Maintenance, Review/Approvals,
  Shift Handover, Routines and Marketing. Check long text, keyboard escape,
  focus return, touch targets and horizontal overflow.
- Confirm allowed tasks and restricted controls for each role with actual
  server responses, not client capability booleans alone.
- Confirm at least one appropriate non-financial, approved business event
  flows from its source application's outbox to the Operations Delivery,
  Inbox and Review workflow (if that event type is designed to create one).
  Observe without automatically producing test journal, payroll, POS or
  inventory transactions.
- Check producer queue/status snapshots again at sign-off. Investigate
  pending/blocked/dead-letter events before proceeding.
- Confirm backup retention, migration state, rollback readiness and the
  immutable release SHA, with no credentials or private payloads included
  in support tickets.

Only after these checks, and the four historical provenance exceptions
are explicitly resolved or formally documented as an approved exception,
may a human owner mark **overall production acceptance** complete.
