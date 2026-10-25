import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts'))
job = importlib.import_module('offsite_backup')
scheduled = importlib.import_module('scheduled_backup')
from test_scheduled_backup import setup


@pytest.fixture
def published(setup, monkeypatch):
    root, current, uploads, base, runner, _, _ = setup
    monkeypatch.setattr(job, 'audit_release_recovery', scheduled.audit_release_recovery)
    source = scheduled.create_snapshot(current, base, uploads, minimum_free_mb=1, runner=runner)
    return current, base, source


class FakeRestic:
    def __init__(self, *, existing=False, usage=0, failed_check=False):
        self.calls = []
        self.existing = existing
        self.usage = usage
        self.failed_check = failed_check

    def run(self, *args):
        self.calls.append(args)
        if args[0] == 'snapshots':
            return json.dumps([{'id': 'b'*64}] if self.existing else []).encode()
        if args[0] == 'stats':
            return json.dumps({'total_size': self.usage}).encode()
        if args[0] == 'backup':
            return json.dumps({'message_type': 'summary', 'snapshot_id': 'b'*64}).encode()
        if args[0] == 'check' and self.failed_check:
            raise job.BackupFailure('Synthetic repository corruption')
        return b'{}'


def test_encrypted_copy_verifies_metadata_and_never_prunes_source_or_cloud(published):
    current, base, source = published
    before = {str(p): p.read_bytes() for p in source.rglob('*') if p.is_file()}
    client = FakeRestic()
    result = job.upload_snapshot(current, base, client)
    assert result['repository_metadata_verified'] and result['release_sha'] == 'a'*40
    assert [a[0] for a in client.calls] == ['snapshots', 'stats', 'backup', 'check']
    assert all(word not in repr(client.calls) for word in ['prune', 'forget', 'init', 'unlock'])
    assert before == {str(p): p.read_bytes() for p in source.rglob('*') if p.is_file()}


def test_repeat_reuses_exact_source_snapshot_without_another_upload(published):
    current, base, _ = published
    client = FakeRestic(existing=True)
    assert job.upload_snapshot(current, base, client)['snapshot_id'] == 'b'*64
    assert [a[0] for a in client.calls] == ['snapshots', 'check']


@pytest.mark.parametrize('problem', ['tamper', 'extra_file', 'external_symlink', 'oversize', 'stale', 'old_release'])
def test_untrusted_or_stale_source_stops_before_cloud_request(published, monkeypatch, problem):
    current, base, source = published
    manifest_path = source/'app/current/release-manifest.json'
    if problem == 'tamper':
        manifest = json.loads(manifest_path.read_text()); Path(manifest['database_backup']).write_bytes(b'tampered')
    elif problem == 'extra_file':
        extra = source/'private-environment'; extra.write_text('Never transmit this'); extra.chmod(0o600)
    elif problem == 'external_symlink':
        (source/'unexpected-link').symlink_to('/etc/passwd')
    elif problem == 'oversize':
        monkeypatch.setattr(job, 'MAX_SNAPSHOT_BYTES', 1)
    elif problem == 'stale':
        manifest = json.loads(manifest_path.read_text()); manifest['built_at'] = '2000-01-01T00:00:00+00:00'; manifest_path.write_text(json.dumps(manifest))
    else:
        current.unlink(); current.symlink_to(current.parent/'releases'/('f'*40))
    client = FakeRestic()
    with pytest.raises((job.BackupFailure, OSError)):
        job.upload_snapshot(current, base, client)
    assert client.calls == []


def test_budget_and_repository_failure_are_failures_not_false_success(published):
    current, base, _ = published
    client = FakeRestic(usage=job.REPOSITORY_BUDGET_BYTES)
    with pytest.raises(job.BackupFailure, match='budget'):
        job.upload_snapshot(current, base, client)
    assert 'backup' not in [a[0] for a in client.calls]
    with pytest.raises(job.BackupFailure, match='corruption'):
        job.upload_snapshot(current, base, FakeRestic(failed_check=True))


def config_files(tmp_path):
    password = tmp_path/'password'; password.write_text('synthetic-test-password-'+'x'*40); password.chmod(0o600)
    keys = tmp_path/'keys'; keys.write_text(json.dumps({'access_key_id': 'synthetic-key', 'secret_access_key': 'synthetic-secret'})); keys.chmod(0o600)
    path = tmp_path/'config'
    config = {'enabled': True, 'free_account_caps_verified': True, 'recovery_key_custody_confirmed': True,
              'repository': 's3:https://s3.us-west-004.backblazeb2.com/synthetic-private-bucket/operations',
              'password_file': str(password), 'credentials_file': str(keys)}
    path.write_text(json.dumps(config)); path.chmod(0o600)
    return path, config


@pytest.mark.parametrize('problem', ['disabled', 'caps', 'custody', 'http', 'other_host', 'userinfo', 'query', 'public_secret', 'symlink_secret'])
def test_disabled_or_unready_configuration_never_enables_cloud(tmp_path, problem):
    path, config = config_files(tmp_path)
    if problem == 'disabled': config['enabled'] = False
    elif problem == 'caps': config['free_account_caps_verified'] = False
    elif problem == 'custody': config['recovery_key_custody_confirmed'] = False
    elif problem == 'http': config['repository'] = config['repository'].replace('https:', 'http:')
    elif problem == 'other_host': config['repository'] = config['repository'].replace('backblazeb2.com', 'example.test')
    elif problem == 'userinfo': config['repository'] = config['repository'].replace('https://', 'https://secret@')
    elif problem == 'query': config['repository'] += '?token=secret'
    elif problem == 'public_secret': Path(config['credentials_file']).chmod(0o644)
    else:
        link = tmp_path/'link'; link.symlink_to(config['password_file']); config['password_file'] = str(link)
    path.write_text(json.dumps(config))
    if problem == 'disabled': assert job.read_config(path) == {'enabled': False}
    else:
        with pytest.raises(job.BackupFailure): job.read_config(path)


def test_cloud_child_gets_no_production_or_debug_environment(tmp_path, monkeypatch):
    path, _ = config_files(tmp_path)
    binary = tmp_path/'restic'; binary.write_bytes(b'placeholder'); binary.chmod(0o700)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://private-production')
    monkeypatch.setenv('DEBUG_LOG', '/tmp/unsafe-log')
    monkeypatch.setenv('HTTPS_PROXY', 'https://untrusted.example')
    client = job.restic_client(job.read_config(path), binary, tmp_path/'cache')
    assert not {'DATABASE_URL', 'DEBUG_LOG', 'HTTPS_PROXY'} & client.environment.keys()
    assert client.environment['AWS_SECRET_ACCESS_KEY'] == 'synthetic-secret'


@pytest.mark.skipif(not os.getenv('OPERATIONS_TEST_RESTIC_BINARY'), reason='Explicit pinned official Restic binary required')
def test_real_encrypted_backup_wrong_password_and_byte_exact_restore(tmp_path):
    binary = Path(os.environ['OPERATIONS_TEST_RESTIC_BINARY'])
    password = tmp_path/'password'; password.write_text('only-synthetic-encryption-key-'+'x'*40); password.chmod(0o600)
    environment = {'PATH': '/usr/bin:/bin', 'HOME': str(tmp_path), 'RESTIC_REPOSITORY': str(tmp_path/'repository'),
                   'RESTIC_PASSWORD_FILE': str(password), 'RESTIC_CACHE_DIR': str(tmp_path/'cache')}
    client = job.Restic(binary, environment)
    source = tmp_path/'source'; source.mkdir()
    data = b'private-synthetic-file-marker-917235\n'*100
    (source/'archive.dump').write_bytes(data)
    client.run('init')
    output = client.run('backup', '--', str(source))
    summary = [json.loads(line) for line in output.splitlines() if json.loads(line).get('message_type') == 'summary'][-1]
    assert len(summary['snapshot_id']) == 64
    client.run('check', '--read-data')
    client.run('restore', summary['snapshot_id'], '--target', str(tmp_path/'restored'))
    restored = tmp_path/'restored'/str(source).lstrip('/')/'archive.dump'
    assert hashlib.sha256(restored.read_bytes()).digest() == hashlib.sha256(data).digest()
    assert not any(b'private-synthetic-file-marker-917235' in p.read_bytes() for p in (tmp_path/'repository').rglob('*') if p.is_file())
    password.write_text('different-wrong-synthetic-key')
    with pytest.raises(job.BackupFailure): client.run('snapshots')


@pytest.mark.skipif(not os.getenv('OPERATIONS_TEST_RESTIC_BINARY'), reason='Explicit pinned official Restic binary required')
def test_real_snapshot_upload_retry_is_idempotent_and_recovery_files_match(published, tmp_path):
    current, base, source = published
    password = tmp_path/'repository-password'; password.write_text('synthetic-independent-recovery-secret-'+'x'*32)
    client = job.Restic(Path(os.environ['OPERATIONS_TEST_RESTIC_BINARY']), {
        'PATH': '/usr/bin:/bin', 'HOME': str(tmp_path), 'RESTIC_REPOSITORY': str(tmp_path/'encrypted-repository'),
        'RESTIC_PASSWORD_FILE': str(password), 'RESTIC_CACHE_DIR': str(tmp_path/'restic-cache')})
    client.run('init')
    first = job.upload_snapshot(current, base, client)
    repeated = job.upload_snapshot(current, base, client)
    assert first['snapshot_id'] == repeated['snapshot_id']
    assert len(json.loads(client.run('snapshots'))) == 1
    client.run('restore', first['snapshot_id'], '--target', str(tmp_path/'restored'))
    for original in source.rglob('*'):
        if original.is_file():
            restored = tmp_path/'restored'/str(original).lstrip('/')
            assert hashlib.sha256(restored.read_bytes()).digest() == hashlib.sha256(original.read_bytes()).digest()
