#!/usr/bin/env python3
"""Copy one verified snapshot to an encrypted repository; never prune backups."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import subprocess

from certify_release_backup_readonly import audit_release_recovery
from scheduled_backup import BackupBusy, BackupFailure, deployment_lock, write_status

MAX_SNAPSHOT_BYTES = 256 * 1024**2
REPOSITORY_BUDGET_BYTES = 8 * 1000**3


def private_file(path: Path) -> Path:
    if not path.is_absolute() or path.is_symlink():
        raise BackupFailure('Private operator file required')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise BackupFailure('Private operator file required')
    if path.parent.is_symlink() or path.parent.stat().st_mode & 0o022:
        raise BackupFailure('Untrusted private-file directory')
    return path


def read_config(path: Path) -> dict:
    private_file(path)
    if path.stat().st_size > 8192:
        raise BackupFailure('Invalid offsite configuration')
    config = json.loads(path.read_text())
    if config.get('enabled') is not True:
        return {'enabled': False}
    if config.get('free_account_caps_verified') is not True or config.get('recovery_key_custody_confirmed') is not True:
        raise BackupFailure('Offsite account and recovery-key readiness not confirmed')
    # No arbitrary backend, plain HTTP, query-string credentials, or URL userinfo.
    repository = config.get('repository', '')
    if not re.fullmatch(r's3:https://s3\.(?:us-west|us-east|eu-central|ca-east)-[0-9]+\.backblazeb2\.com/[a-z0-9][a-z0-9-]{4,61}[a-z0-9]/operations', repository):
        raise BackupFailure('Expected a private Backblaze S3 repository')
    password = private_file(Path(config.get('password_file', '')))
    credentials = private_file(Path(config.get('credentials_file', '')))
    if not 32 <= password.stat().st_size <= 4096 or credentials.stat().st_size > 4096:
        raise BackupFailure('Invalid offsite secret file')
    keys = json.loads(credentials.read_text())
    if any(not isinstance(keys.get(key), str) or not keys[key].strip() or keys[key].startswith('ENTER_') for key in ('access_key_id', 'secret_access_key')):
        raise BackupFailure('Offsite credentials not installed')
    return {**config, 'password_file': str(password), 'keys': keys}


class Restic:
    def __init__(self, binary: Path, environment: dict[str, str]):
        self.binary = binary
        self.environment = environment

    def run(self, *args: str) -> bytes:
        result = subprocess.run([str(self.binary), '--json', *args], env=self.environment,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=1800)
        if result.returncode or len(result.stdout) > 1024**2:
            # Restic output can contain filenames or provider diagnostics.
            raise BackupFailure('Encrypted repository command failed; private output suppressed')
        return result.stdout


def restic_client(config: dict, binary: Path, cache: Path) -> Restic:
    info = binary.stat()
    if binary.is_symlink() or not binary.is_absolute() or not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise BackupFailure('Trusted operator-installed Restic binary required')
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    if cache.is_symlink() or cache.stat().st_uid != os.geteuid() or cache.stat().st_mode & 0o077:
        raise BackupFailure('Private Restic cache required')
    # Do not inherit production DB credentials, proxy overrides, debug logging,
    # alternate repositories or password commands into the cloud process.
    return Restic(binary, {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(cache),
                          'RESTIC_CACHE_DIR': str(cache), 'RESTIC_REPOSITORY': config['repository'],
                          'RESTIC_PASSWORD_FILE': config['password_file'],
                          'AWS_ACCESS_KEY_ID': config['keys']['access_key_id'],
                          'AWS_SECRET_ACCESS_KEY': config['keys']['secret_access_key']})


def verified_snapshot(current: Path, base: Path) -> tuple[Path, str, int]:
    release = current.resolve(strict=True)
    sha = release.name
    if not current.is_symlink() or release != current.parent/'releases'/sha or not re.fullmatch('[a-f0-9]{40}', sha):
        raise BackupFailure('Invalid active release')
    if base.is_symlink() or base.resolve() != base or base.stat().st_mode & 0o077 or base.stat().st_uid != os.geteuid():
        raise BackupFailure('Private scheduled backup directory required')
    latest = base/'latest'
    snapshot = latest.resolve(strict=True)
    if not latest.is_symlink() or snapshot.parent != base or not re.fullmatch(r'snapshot-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}', snapshot.name):
        raise BackupFailure('Invalid published snapshot')
    if snapshot.stat().st_uid != os.geteuid() or snapshot.stat().st_mode & 0o077:
        raise BackupFailure('Private published snapshot required')
    manifest = json.loads((snapshot/'app/releases'/sha/'release-manifest.json').read_text())
    age = (datetime.now(timezone.utc)-datetime.fromisoformat(manifest['built_at'])).total_seconds()
    if manifest.get('recovery_descriptor_only') is not True or not 0 <= age <= 3900:
        raise BackupFailure('Fresh scheduled recovery descriptor required')
    report = audit_release_recovery(expected_sha=sha, current=snapshot/'app/current', backup_dir=snapshot/'backups')
    if report['status'] != 'pass':
        raise BackupFailure('Snapshot integrity verification failed')
    expected = {snapshot/'app/releases'/sha/name for name in ['release-manifest.json', 'backend/requirements.txt', 'frontend/package-lock.json']}
    for kind in ['database', 'uploads']:
        archive = Path(manifest[kind+'_backup'])
        expected.update([archive, Path(str(archive)+'.sha256')])
    found = set()
    total = 0
    for path in snapshot.rglob('*'):
        if path.is_symlink():
            if path != snapshot/'app/current' or path.resolve() != snapshot/'app/releases'/sha:
                raise BackupFailure('Unexpected snapshot symlink')
        elif not path.is_dir():
            private_file(path)
            found.add(path)
            total += path.stat().st_size
    if found != expected or total > MAX_SNAPSHOT_BYTES:
        raise BackupFailure('Unexpected snapshot files or size limit exceeded')
    return snapshot, sha, total


def upload_snapshot(current: Path, base: Path, client: Restic) -> dict:
    snapshot, sha, size = verified_snapshot(current, base)
    tag = 'source:'+snapshot.name
    # Repeated invocations reuse this exact source snapshot. No init, forget,
    # prune, unlock, lifecycle change or deletion of backup objects is performed.
    existing = json.loads(client.run('snapshots', '--tag', tag))
    if existing:
        if len(existing) != 1 or not re.fullmatch('[a-f0-9]{64}', existing[0].get('id', '')):
            raise BackupFailure('Unexpected repository snapshot identity')
        identifier = existing[0]['id']
    else:
        usage = json.loads(client.run('stats', '--mode', 'raw-data'))
        used = usage.get('total_size')
        if type(used) is not int or used < 0 or used+size+64*1024**2 > REPOSITORY_BUDGET_BYTES:
            raise BackupFailure('Offsite repository budget reached; owner retention decision needed')
        output = client.run('backup', '--host', 'hidden-oasis-operations', '--tag', 'scheduled', '--tag', 'release:'+sha,
                            '--tag', tag, '--', str(snapshot/'app'), str(snapshot/'backups'))
        summaries = [row for line in output.splitlines() if (row := json.loads(line)).get('message_type') == 'summary']
        identifier = summaries[-1].get('snapshot_id', '') if summaries else ''
        if not re.fullmatch('[a-f0-9]{64}', identifier):
            raise BackupFailure('Encrypted upload completion not verified')
    # Verify repository structure/indexes. A separate real cloud restore is
    # required before schedule activation; do not claim full data-read integrity.
    client.run('check')
    return {'status': 'pass', 'release_sha': sha, 'snapshot_id': identifier,
            'repository_metadata_verified': True, 'archives_deleted': False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('/etc/hiddenoasis/operations-offsite.json'))
    args = parser.parse_args()
    os.umask(0o077)
    if os.geteuid() != 0:
        parser.error('Run as the authorized backup operator')
    status = Path('/var/lib/operations-command-center-backup/offsite-status.json')
    try:
        config = read_config(args.config)
        if not config['enabled']:
            print('{"status":"disabled","cloud_requests_sent":false}')
            return 0
        with deployment_lock(Path('/run/operations-command-center.deploy.lock')):
            client = restic_client(config, Path('/usr/local/bin/restic'), Path('/var/cache/operations-command-center-offsite'))
            report = upload_snapshot(Path('/opt/operations-command-center/current'), Path('/root/backups/operations-command-center/scheduled'), client)
            write_status(status, 'ok', success_sha=report['release_sha'])
        # Repository identifiers and private paths stay out of the journal.
        print('{"status":"pass","repository_metadata_verified":true,"archives_deleted":false}')
        return 0
    except BackupBusy:
        write_status(status, 'busy')
        print('{"status":"busy","retry":"next_timer"}')
        return 0
    except Exception:
        write_status(status, 'failed')
        print('{"status":"failed","detail":"Inspect offsite credentials, source freshness, account caps and repository integrity; private diagnostics suppressed"}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
