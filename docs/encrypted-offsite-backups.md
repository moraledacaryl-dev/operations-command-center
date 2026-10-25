# Encrypted Backblaze recovery copies

This operator-only job copies a verified scheduled DB/uploads snapshot using
Restic client-side encryption and Backblaze's S3-compatible API. It never opens
the live database, changes business records, prunes archives, or initializes a
repository automatically. The source local backup schedule works independently.

## Activation gate

The example configuration is **disabled**, neither offsite unit is installed or
enabled by the application deployment, and no cloud requests occur while it is
disabled. Activate only after all these facts are established:

1. The business owner created/verified the account and accepted the provider's
   Terms. Verify its effective region and free-account storage/transaction caps;
   leave payment methods and paid billing disabled.
2. A dedicated **private** bucket exists, with default server-side encryption.
   Preserve existing objects and versions. Do not introduce lifecycle expiration,
   automatic pruning or irreversible Object Lock policy without owner approval.
3. The owner approved a standard application key scoped to that bucket and the
   `operations/` prefix. Restic requires read/write and transient lock removal.
   Do not grant account administration, all-bucket access or a master key. Never
   paste the key into chat, GitHub, shell arguments/history or public logs.
4. Use a unique strong encryption password. Keep a recovery copy under owner
   control **outside the VPS**. Losing this password makes the backup unusable;
   the Backblaze login or app key alone does not decrypt it.
5. Perform a real encrypted cloud upload, private independent download and
   isolated PostgreSQL/uploads/application restore. A successful command or
   repository metadata check alone is not a recovery exercise.

## Private operator configuration

Prepare pinned official Restic 0.19.1 using `scripts/prepare_restic_binary.py`
into a new private scratch directory. It validates the official asset's SHA-256
before decompressing; it will not replace an existing binary. Install its verified
binary as root-owned `/usr/local/bin/restic` mode 0755. The uploader rejects a
symlink or a group/world-writable binary.

Install `deployment/operations-offsite.example.json` as root-only
`/etc/hiddenoasis/operations-offsite.json` mode 0600. Set the actual bucket S3
endpoint shown by Backblaze; the example endpoint is a placeholder, not discovery.
The repository must use HTTPS, the `backblazeb2.com` endpoint and `operations`
prefix. Other hosts, plain HTTP, URL passwords and query strings are rejected.

Enter secrets through a hidden private operator input flow. The credentials JSON
has only `access_key_id` and `secret_access_key`; the separate password file holds
the Restic encryption password. Both paths are specified in the config. Files
must be private regular operator-owned files, with no symlinks or writable parent
directory. No production application environment file is needed by this job.

Leave `enabled`, `free_account_caps_verified` and `recovery_key_custody_confirmed`
false until the respective facts have been directly verified. Initialize the
correct encrypted repository once in the private operator session; the scheduled
job refuses to initialize a missing repository.

## Runtime behavior and capacity

The job shares the deployment/local-backup lock. It verifies the active SHA,
published snapshot/checksums/archive indexes, exact allowed file inventory and
source age (at most 65 minutes) before any cloud request. Unexpected files,
symlinks, altered bytes or archives over 256 MiB stop the job. Only the scheduled
recovery descriptor and its archives are uploaded; production secrets are excluded.

Repeated invocations reuse the exact source tag. New copies stop before exceeding
an 8 GB logical Restic data budget with a 64 MiB reserve. This is a conservative
application guard, **not a provider billing guarantee**: provider object versions,
failed uploads, metadata, requests and downloads also count. Read the effective
account caps and storage metrics. The first 10 GB offer is not unlimited free
retention. Stop for an owner capacity/retention decision rather than raising caps,
adding billing or deleting evidence automatically.

Each successful job runs Restic's repository metadata/index check. It does not
read every stored data block hourly or certify restoration. Keep separate actual
cloud-restore evidence and an owner-approved exercise cadence/RPO/RTO. S3 lock
removal can leave hidden object versions in B2; with no automatic deletion policy,
monitor their storage usage as well. Backblaze/Restic's usual lifecycle cleanup
recommendation is deliberately not applied without the owner's retention decision.

After successful real cloud recovery, install both offsite units, validate with
`systemd-analyze verify`, then enable the timer. It runs hourly at ten minutes past
the hour, after the local snapshot. It uses its own credentials, private cache,
restricted filesystem and sanitized status at
`/var/lib/operations-command-center-backup/offsite-status.json`. Journal and status
retain no key, business name, filename, bucket endpoint or private payload. Failed
or busy jobs preserve last successful status; use `systemctl status`/the status
file to investigate. Health's existing Backups card continues to represent the
**local** backup job; it does not imply offsite success.

## Verification

Run unit/safety checks with the backend tests. Set
`OPERATIONS_TEST_RESTIC_BINARY` to the verified binary to run actual encryption,
wrong-password rejection, byte-exact restore and repeat-upload idempotency using
only disposable synthetic local data. CI downloads the checksum-pinned official
Linux binary and runs these real checks. These are not cloud delivery evidence.

Primary references checked October 25, 2026:

- https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- https://github.com/restic/restic/releases/tag/v0.19.1
- https://www.backblaze.com/docs/cloud-storage-application-keys
- https://www.backblaze.com/docs/cloud-storage-data-caps-and-alerts
- https://www.backblaze.com/cloud-storage/pricing
