# Hourly recovery snapshots

The owner approved hourly private database/uploads backups on October 25, 2026,
with no automatic deletion of archives. Deployment backups and historical
evidence remain untouched. The timer is enabled separately by an operator only
after the exact release has passed CI and guarded deployment.

The snapshot service shares the deployment lock. It checks free disk capacity,
verifies the immutable release/code fingerprints, creates complete DB/uploads
archives, verifies private checksums and archive indexes, and publishes a new
snapshot directory atomically. A failed attempt does not advance `latest`.
Vendor output is suppressed so credentials, file names and payloads do not enter
the journal. A sanitized root-owned status file exposes only outcome/time/SHA.
System Health warns on a failed attempt or no success for more than 65 minutes.

No pruning or offsite upload is implemented. Without a retention decision,
snapshots accumulate; a 2 GiB free-space floor stops new snapshots and reports
failure rather than deleting evidence. The one-hour recovery-point objective is
a target, not a guarantee: failures, long jobs, lock contention and host loss can
extend it. The operator must respond to overdue/failure status. A same-host
snapshot does not protect against loss of the host or its storage.

## Activation after green CI and guarded deployment

Verify the exact active release, then install its two unit files, validate them
with `systemd-analyze verify`, and run `systemctl enable --now operations-backup.timer`.
The first automatic run is scheduled 30 seconds after activation; subsequent
runs follow the hourly calendar. `Persistent=true` catches missed calendar runs
after reboot. Inspect timer next/last trigger, service exit status and journal,
and independently inspect the newly published snapshot. Never display the
environment file or production database URL.

Units require the existing private `/root/backups/operations-command-center`
parent. Systemd creates `/var/lib/operations-command-center-backup`; its status
is readable by the backend but contains no archive paths or business records.

## Actual isolated restore

Each private snapshot contains `backups/` and `app/current`, pointing to a
recovery descriptor under `app/releases/SHA`. The descriptor includes the
original source fingerprints and manifest, not a running application or a full
source-code copy. The production release manifest is never edited.

Use the existing guarded tool with `--current SNAPSHOT/app/current`,
`--backup-dir SNAPSHOT/backups`, the recorded exact SHA, and
`--acknowledge-disposable-drill`. On an authorized staging/Mac host, securely
copy the archives and fingerprints, verify original hashes, and rewrite only
the staging descriptor/checksum paths to their local locations. Never change
the original snapshot. Restore into a newly owned local PostgreSQL container
with no network, ports or host mounts; clean its private storage afterward.

Full application-stack recovery, restored attachment usability, ongoing offsite
copies, retention policy and approved recovery-time targets remain separate
acceptance items. Synthetic CI backups do not replace an actual restore of a
verified production snapshot.

Deployment archives are taken before schema upgrades. Their manifest records
`database_backup_migration_head` separately from the application `migration_head`.
The restore tool validates the actual backed-up revision and reports whether
application migrations are still required in the isolated restored environment.
Never downgrade production to test this. Scheduled snapshots are taken after
activation and retain the current application schema revision.
