import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts'))
job = importlib.import_module('scheduled_backup')
audit = importlib.import_module('certify_release_backup_readonly')
from app.backup_status import backup_status


@pytest.fixture
def setup(tmp_path, monkeypatch):
    root = tmp_path.resolve()
    sha = 'a' * 40
    release = root / 'app/releases' / sha
    release.mkdir(parents=True)
    current = root / 'app/current'; current.symlink_to(release, target_is_directory=True)
    manifest = {'release_sha': sha, 'migration_head': '0011_project_collaboration'}
    for name, key in [('backend/requirements.txt', 'requirements_sha256'), ('frontend/package-lock.json', 'package_lock_sha256')]:
        f = release / name; f.parent.mkdir(exist_ok=True); f.write_text('synthetic source fingerprint')
        manifest[key] = hashlib.sha256(f.read_bytes()).hexdigest()
    original_manifest = release / 'release-manifest.json'; original_manifest.write_text(json.dumps(manifest))
    uploads = root / 'uploads'; uploads.mkdir(); (uploads / 'fixture.txt').write_text('Synthetic upload')
    base = root / 'snapshots'; base.mkdir(mode=0o700)
    existing = base / 'existing-deployment-evidence'; existing.write_text('Preserve this evidence')
    def verify(**kwargs):
        return audit.audit_release_recovery(**kwargs, inspect_postgres=lambda p: p.read_bytes() == b'synthetic-dump')
    monkeypatch.setattr(job, 'audit_release_recovery', verify)
    monkeypatch.setattr(job, 'current_database_revision', lambda release: '0011_project_collaboration')
    commands = []
    def runner(args):
        commands.append(args)
        assert 'secret' not in repr(args)
        if args[0] == 'bash':
            subprocess.run(['bash', str(REPO / 'scripts/backup_uploads.sh'), args[-2], args[-1]], check=True)
        else:
            Path(args[-1]).write_bytes(b'synthetic-dump')
    return root, current, uploads, base, runner, commands, original_manifest


def test_complete_verified_snapshot_is_restorable_and_never_prunes_existing_evidence(setup):
    root, current, uploads, base, runner, commands, original = setup
    before = original.read_bytes()
    result = job.create_snapshot(current, base, uploads, minimum_free_mb=1, runner=runner)
    assert (base/'latest').resolve() == result
    manifest = json.loads((result/'app/current/release-manifest.json').read_text())
    assert manifest['recovery_descriptor_only'] is True
    assert Path(manifest['database_backup']).is_file()
    report = job.audit_release_recovery(expected_sha='a'*40, current=result/'app/current', backup_dir=result/'backups')
    assert report['status'] == 'pass'
    assert original.read_bytes() == before
    assert (base/'existing-deployment-evidence').read_text() == 'Preserve this evidence'
    assert (uploads/'fixture.txt').read_text() == 'Synthetic upload'
    assert not list(base.glob('.incomplete-*'))
    for f in (result/'backups').iterdir():
        assert f.stat().st_mode & 0o077 == 0
    assert len(commands) == 2


def test_failed_backup_never_publishes_or_replaces_prior_snapshot(setup):
    _, current, uploads, base, _, _, _ = setup
    def fail(args):
        Path(args[-1]).write_bytes(b'incomplete')
        raise job.BackupFailure('Synthetic failure')
    with pytest.raises(job.BackupFailure):
        job.create_snapshot(current, base, uploads, minimum_free_mb=1, runner=fail)
    assert not (base/'latest').exists()
    assert list(base.iterdir()) == [base/'existing-deployment-evidence']


def test_fingerprint_failure_and_disk_floor_stop_before_database_dump(setup):
    _, current, uploads, base, _, _, _ = setup
    def forbidden(args):
        pytest.fail('Must not run a backup command')
    with pytest.raises(job.BackupFailure, match='capacity'):
        job.create_snapshot(current, base, uploads, minimum_free_mb=10**12, runner=forbidden)
    (current/'backend/requirements.txt').write_text('tampered')
    with pytest.raises(job.BackupFailure, match='fingerprint'):
        job.create_snapshot(current, base, uploads, minimum_free_mb=1, runner=forbidden)


def test_job_shares_the_deployment_lock_and_releases_it_on_failure(tmp_path):
    lock = tmp_path/'deploy.lock'
    with job.deployment_lock(lock):
        with pytest.raises(job.BackupBusy):
            with job.deployment_lock(lock):
                pytest.fail('A second lock must not succeed')
    with job.deployment_lock(lock):
        pass
    link = tmp_path/'symlink.lock'; link.symlink_to(lock)
    with pytest.raises(OSError):
        with job.deployment_lock(link):
            pytest.fail('Must reject symlink locks')


def test_schema_drift_stops_before_archive_publication(setup, monkeypatch):
    _, current, uploads, base, runner, commands, _ = setup
    monkeypatch.setattr(job, 'current_database_revision', lambda release: '0002_integration_identity')
    with pytest.raises(job.BackupFailure, match='schema differs'):
        job.create_snapshot(current, base, uploads, minimum_free_mb=1, runner=runner)
    assert not commands and not (base/'latest').exists()


def test_status_preserves_last_success_on_failure_without_exposing_unknown_fields(tmp_path):
    path = tmp_path/'status.json'
    job.write_status(path, 'ok', success_sha='a'*40)
    original = json.loads(path.read_text())
    job.write_status(path, 'failed')
    failed = json.loads(path.read_text())
    assert failed['last_success_at'] == original['last_success_at']
    assert failed['last_attempt_status'] == 'failed'
    assert path.stat().st_mode & 0o777 == 0o644
    assert backup_status(path)['status'] == 'failed'


@pytest.mark.parametrize('scenario,expected', [('fresh','current'),('old','stale'),('failed','failed'),('future','unknown'),('no_success','failed'),('invalid','unknown')])
def test_health_status_is_bounded_and_private(tmp_path, scenario, expected):
    now = datetime(2026,10,25,tzinfo=timezone.utc)
    data = {'last_success_at':now.isoformat(), 'last_success_release':'a'*40, 'last_attempt_status':'ok', 'private_payload':'must not escape'}
    if scenario=='old':data['last_success_at']=(now-timedelta(hours=3)).isoformat()
    if scenario=='failed':data['last_attempt_status']='failed'
    if scenario=='future':data['last_success_at']=(now+timedelta(days=1)).isoformat()
    if scenario=='no_success':data.pop('last_success_at');data['last_attempt_status']='failed'
    if scenario=='invalid':data['last_success_at']='invalid'
    path=tmp_path/'status.json';path.write_text(json.dumps(data))
    result=backup_status(path,now=now)
    assert result['status']==expected
    assert 'must not escape' not in json.dumps(result)
    assert set(result)=={'status','last_success_at','last_attempt_status'}


def test_missing_or_symlinked_status_is_unknown(tmp_path):
    assert backup_status(tmp_path/'absent')['status']=='unknown'
    target=tmp_path/'private';target.write_text('private')
    link=tmp_path/'status';link.symlink_to(target)
    assert backup_status(link)['status']=='unknown'
