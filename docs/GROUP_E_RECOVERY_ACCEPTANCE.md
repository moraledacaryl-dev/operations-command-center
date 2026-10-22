# Group E — Read-only release and recovery evidence

Run this step on the Operations VPS after an exact-SHA `DEPLOYMENT GATE: PASS`
and the standard runtime readiness audit. It independently checks the active
immutable release, saved release-manifest SHA/migration metadata, frontend and
backend dependency fingerprints, and both private backup archives and their
SHA-256 checksums.

Use the **actual deployed release**; running a script from another checkout
does not establish that its changes are present in production:

```bash
sudo /opt/operations-command-center/current/backend/.venv/bin/python \
  /opt/operations-command-center/current/scripts/certify_release_backup_readonly.py \
  --expected-sha FULL_40_CHARACTER_MAIN_SHA
```

If the verifier has not yet been deployed, run the same committed script from
a trusted GitHub checkout and provide the active release/backup paths
explicitly; independent signed-code provenance is then still a separate
acceptance check.

## What a green result proves

- Exact active release symlink and manifest SHA match `--expected-sha`.
- Recorded migration revision is present (not a query of the live Alembic
  database revision; verify separately as needed).
- Lockfile and requirements hashes still match the recorded release inputs.
- Both DB and uploads backups are private regular files inside the configured
  backup directory, with private SHA256 sidecars matching actual bytes.
- `pg_restore --list` can read the database dump index. The upload archive is
  traversable as a tar.gz without a path traversal, device or link entry.

No database is connected to, restored, altered, restarted or migrated. No
archives are extracted, and no credentials, archive paths, guest narratives or
source payloads are printed. Exit **0** means these checks passed; exit **2**
means investigate. The read-only inspector does **not** prove a PostgreSQL
restore will succeed, that uploaded documents will be usable after restore,
that the backup is sufficiently recent for business recovery needs, or that
the infrastructure can be rebuilt.

## Remaining human/operational acceptance

1. Confirm full post-deployment `certify_operations_readiness` output for the
   same SHA, and separately preserve the four known Sept 10 historical Review
   findings. Exit 2 from that audit must never be disguised as green.
2. Validate the actual backup file and uploads archive can be restored **only
   to a separate isolated disposable environment**, with independent checksum,
   migration state and sample attachment usability checks. **Never restore to
   the live database** or run an experimental database downgrade in production.
3. Verify systemd unit configuration, active working directories, persistent
   uploads, production HTTPS asset serving and operational role/device behavior
   for Owner/Manager/Supervisor/Staff.
4. Record the Recovery Point Objective (RPO), Recovery Time Objective (RTO),
   backup retention and off-host copy policy as owner-approved decisions.
   Do not invent targets or claim off-host backup coverage without evidence.
5. Complete Group C real producer→Delivery→Inbox→Review evidence and obtain
   explicit historical exception disposition on issue #185 before final
   organizational sign-off.

The production deploy script can revert the **application symlink** if
activation fails; it does **not** reverse Alembic database migrations. Never
describe it as a guaranteed full-system rollback. Use the backed-up data and
an authorized isolated restore runbook for serious database incidents.
