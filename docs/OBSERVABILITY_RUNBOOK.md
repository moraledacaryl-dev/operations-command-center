# Operations observability runbook

Every HTTP response emits a secret-free JSON log with timestamp, request ID,
release SHA, method, route template, status, duration and authentication mode.
The protected `/api/metrics` endpoint exposes low-cardinality request, login and
workflow-conflict counters for users with system-health access.

Never log passwords, cookies, bearer tokens, integration keys, request bodies,
captions, notes, uploaded content or raw integration payloads.

Recommended initial alerts:

- readiness is non-200 for two consecutive minutes: page the deployment owner;
- 5xx exceeds 2% for five minutes: page engineering and correlate by release SHA;
- login blocks exceed 10 in five minutes: investigate source IPs and account targets;
- workflow conflicts exceed 20 in ten minutes: inspect stale clients or automation;
- integration outbox oldest pending item exceeds 10 minutes: notify integration owner;
- release smoke fails: deployment must roll back and remain blocked.

For an incident, record the public request ID, live `release_sha`, Alembic head,
affected route/status, UTC start/end and remediation. Validate recovery through
the public origin; do not paste credentials or payload data into the incident log.
