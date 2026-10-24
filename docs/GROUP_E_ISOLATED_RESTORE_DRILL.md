# Group E — Isolated restore rehearsal (operator-gated)

The separate **read-only** `certify_release_backup_readonly.py` has already
passed on release `b05381584b617cb6745b0711820811b0444dd416`.
This rehearsal goes further by restoring database archive contents into a
**fresh disposable PostgreSQL container** and materializing backed-up uploads
into a private throwaway directory for byte-for-byte verification.

The script does **not** run automatically on import, on deployment, in CI, or
from a green GitHub status. It requires an operator's explicit flag. Prefer a
**dedicated staging host** with an authorized secure copy of the original
release manifest and archives, ample scratch space and a trusted Docker engine.
Production data must not be copied to a public CI artifact or committed to Git.

## Safety guards

- The release SHA, private backup checksum files, archive indexes, and release
  manifest must pass the existing independent audit before any restoration.
- A brand-new randomly named Docker container uses **postgres:16-alpine**
  (matching `docker-compose.yml`), `--network=none`, `--pull=never`,
  **no published ports**, **no host volumes**, and bounded memory/CPU/PIDs.
  It receives **no production DB credentials, DB host or environment file**.
- Refuses remote Docker daemon environment overrides. Inspects the actual
  endpoint of `default` or Docker Desktop's `desktop-linux` context; it must
  be a Unix socket at `/var/run/docker.sock` or the current operator's
  `~/.docker/run/docker.sock`, owned by root or that operator. TCP/SSH,
  unknown contexts and arbitrary socket paths remain forbidden. This permits
  an unprivileged local Mac rehearsal without a privileged helper or system
  socket symlink; it does not permit private archives to reach remote engines.
- The pg_dump archive is streamed through `docker exec -i pg_restore` to the
  disposable database. No `pg_restore` command has a live database URL.
  Post-restore checks require all core table names, exact Alembic revision,
  nonempty restored users and queryable Operations integration tables.
- Uploads are extracted only to a private temporary directory, with
  strict traversal/link/device rejection and a bounded unpacked-size limit.
  Each file is reopened and its restored SHA-256 verified. Temporary data and
  the disposable container are removed after success or failure.
- The report contains only aggregate counts/booleans and an error category.
  It does not disclose files, guest names, transactions, credentials, or
  individual source event IDs.
- An isolated restore **does not** repair the four historical missing Reviews,
  prove an off-host backup, or replace real-device/role sign-off.

## Operator procedure

1. Confirm a trusted `postgres:16-alpine` image is **already cached** on the
   Docker engine used for the test (`docker image inspect postgres:16-alpine`).
   Its pull policy is deliberately `never` to avoid network activity.
2. On a dedicated staging host, arrange the same read-only archive layout
   under a private directory. Its release manifest references absolute paths;
   either reproduce those private paths securely or generate a separately
   audited staging-only manifest. Do **not** change the production manifest.
   On the production host, there are no host DB volumes mounted and no exposed
   container ports, but dedicated staging is preferred to avoid disk pressure.
3. Run from the **newly deployed** release or a trusted checkout containing
   the script (not the previous `b053815` release):

```bash
sudo /opt/operations-command-center/current/backend/.venv/bin/python \
  /opt/operations-command-center/current/scripts/isolated_restore_drill.py \
  --expected-sha FULL_NEW_40_CHARACTER_SHA \
  --acknowledge-disposable-drill
```

The script refuses execution without the acknowledgment flag. You may set
`--max-upload-bytes` to a larger documented allowance if a legitimate archive
exceeds the default 2 GiB. It does **not** silently waive the limit.

4. Save the sanitized report and separately confirm the disposable container
   has been removed. Record the host class, tested release SHA, date, operator,
   actual duration, aggregate restore counts and any failures privately.
5. For formal disaster recovery sign-off also validate a representative restored
   attachment renders correctly through an **isolated** application instance,
   define owner-approved RPO/RTO and retention policy, and establish a tested
   off-host recovery copy. This script proves database and file restoration,
   not an entire application stack recovery.

**Never** run `pg_restore --clean`, a database downgrade, source event replay,
or a live production DB restore to pass this gate. The deployment script's
rollback changes its application symlink only; it does not reverse migrations.
