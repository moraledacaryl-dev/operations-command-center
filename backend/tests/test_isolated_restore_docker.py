"""Opt-in real Docker regression using only synthetic disposable data."""
import importlib
import os
from pathlib import Path
import re
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
drill = importlib.import_module("isolated_restore_drill")


@pytest.mark.skipif(os.getenv("OPERATIONS_TEST_DOCKER_RESTORE") != "1", reason="Requires explicitly enabled local Docker and cached postgres:16-alpine")
def test_real_postgres_restore_removes_its_anonymous_volume(tmp_path):
    drill.require_local_docker_engine()
    def execute(args, **kwargs):
        return drill.require_ok(drill.safe_execute(args, **kwargs), "Synthetic restore regression")
    def volumes():
        return set(execute(["docker", "volume", "ls", "--quiet"]).splitlines())
    before = volumes()
    source = None
    try:
        source = execute(drill.container_start_args("operations-restore-" + drill.secrets.token_hex(6))).decode().strip()
        assert re.fullmatch(r"[a-f0-9]{64}", source)
        for _ in range(45):
            ready = drill.safe_execute(["docker", "exec", source, "pg_isready", "--host", "127.0.0.1", "--username", drill.DB_USER, "--dbname", drill.DB_NAME])
            if ready.returncode == 0:
                break
            drill.time.sleep(1)
        else:
            pytest.fail("Synthetic source PostgreSQL did not initialize")
        sql = ";".join("CREATE TABLE " + table + " (id integer)" for table in drill.CORE_TABLES if table != "alembic_version")
        sql += ";CREATE TABLE alembic_version(version_num varchar(64));INSERT INTO alembic_version VALUES ('0011_project_collaboration');INSERT INTO users VALUES (1)"
        execute(["docker", "exec", source, "psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--username", drill.DB_USER, "--dbname", drill.DB_NAME, "--command", sql])
        archive = tmp_path / "synthetic.dump"
        archive.write_bytes(execute(["docker", "exec", source, "pg_dump", "--format=custom", "--username", drill.DB_USER, "--dbname", drill.DB_NAME]))
        archive.chmod(0o600)
        result = drill.restore_database(archive, "0011_project_collaboration")
        assert result["full_pg_restore_succeeded"]
        assert result["required_tables_present"]
        assert result["migration_matches_release_manifest"]
        assert result["users_nonempty"]
    finally:
        if source and re.fullmatch(r"[a-f0-9]{64}", source):
            execute(["docker", "rm", "--force", "--volumes", source])
    assert volumes() == before, "Disposable PostgreSQL left anonymous database storage behind"
