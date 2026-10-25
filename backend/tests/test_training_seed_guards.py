"""No production or existing database may ever be written by the training seeder."""
import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'seed_training_demo.py'
spec = importlib.util.spec_from_file_location('training_seed', SCRIPT)
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


@pytest.mark.parametrize('env,url,auto,bootstrap', [
    ('production', 'sqlite:////tmp/operations_training_demo_test.sqlite', 'false', 'false'),
    ('staging', 'sqlite:////tmp/operations_training_demo_test.sqlite', 'false', 'false'),
    ('local', 'postgresql://database/training', 'false', 'false'),
    ('local', 'sqlite:////tmp/command_center.sqlite', 'false', 'false'),
    ('local', 'sqlite:////tmp/operations_training_demo_test.sqlite', 'true', 'false'),
    ('local', 'sqlite:////tmp/operations_training_demo_test.sqlite', 'false', 'true'),
    ('development', 'sqlite:////tmp/operations_training_demo_test.sqlite', 'false', 'false'),
])
def test_unsafe_database_settings_are_rejected(env, url, auto, bootstrap):
    with patch.dict(os.environ, {'ENVIRONMENT': env, 'DATABASE_URL': url,
                                 'ALLOW_DEMO_SEED': auto,
                                 'ALLOW_DEFAULT_ADMIN_BOOTSTRAP': bootstrap}, clear=True):
        with pytest.raises(SystemExit, match='REFUSED'):
            seed.guard()


def test_unmigrated_file_is_rejected():
    with TemporaryDirectory() as root:
        file = Path(root) / 'operations_training_demo_00.sqlite'
        file.touch()
        with patch.dict(os.environ, {'ENVIRONMENT': 'local',
                'DATABASE_URL': 'sqlite:///' + str(file),
                'ALLOW_DEMO_SEED': 'false', 'ALLOW_DEFAULT_ADMIN_BOOTSTRAP': 'false'}, clear=True):
            with pytest.raises(SystemExit, match='REFUSED'):
                seed.guard()


def test_guard_catches_symlink_database():
    with TemporaryDirectory() as root:
        real_file = Path(root) / 'not_a_training_database'
        real_file.write_bytes(b'test')
        linked = Path(root) / 'operations_training_demo_1.sqlite'
        linked.symlink_to(real_file)
        with patch.dict(os.environ, {'ENVIRONMENT': 'test',
                'DATABASE_URL': 'sqlite:///' + str(linked),
                'ALLOW_DEMO_SEED': 'false',
                'ALLOW_DEFAULT_ADMIN_BOOTSTRAP': 'false'}, clear=True):
            with pytest.raises(SystemExit, match='REFUSED'):
                seed.guard()


def test_bad_acknowledgement_is_rejected_before_database_access(monkeypatch):
    monkeypatch.setattr(seed, 'guard', lambda: (_ for _ in ()).throw(AssertionError('DB accessed')))
    with patch('sys.argv', [str(SCRIPT), '--confirm', 'yes',
                             '--private-output', '/tmp/not-needed']):
        with pytest.raises(SystemExit, match='REFUSED'):
            seed.main()
