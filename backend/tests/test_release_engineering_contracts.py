import ast
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_alembic_revision_ids_fit_postgresql_version_column():
    revisions = []
    for migration in (REPO_ROOT / "backend" / "alembic" / "versions").glob("*.py"):
        tree = ast.parse(migration.read_text())
        assignment = next(
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "revision" for target in node.targets)
        )
        revision = ast.literal_eval(assignment.value)
        assert len(revision) <= 32, f"{migration.name} revision exceeds Alembic's default VARCHAR(32)"
        revisions.append(revision)
    assert len(revisions) == len(set(revisions))


def test_frontend_dockerfile_uses_lockfile_and_npm_ci():
    dockerfile = (REPO_ROOT / "frontend" / "Dockerfile").read_text()
    assert "COPY package.json package-lock.json ./" in dockerfile
    assert "RUN npm ci" in dockerfile
    assert "RUN npm install" not in dockerfile


def test_frontend_build_packages_standalone_static_assets():
    package_json = (REPO_ROOT / "frontend" / "package.json").read_text()
    packager = (REPO_ROOT / "frontend" / "scripts" / "package-standalone.mjs").read_text()
    assert '"build": "next build && npm run package:standalone"' in package_json
    assert "targetStatic" in packager
    assert "standaloneDir" in packager


def test_frontend_has_dockerignore_for_secrets_and_build_outputs():
    dockerignore = (REPO_ROOT / "frontend" / ".dockerignore").read_text().splitlines()
    assert ".next" in dockerignore
    assert "node_modules" in dockerignore
    assert ".env*" in dockerignore


def test_frontend_html_sets_hsts_and_nonce_csp():
    middleware = (REPO_ROOT / "frontend" / "middleware.ts").read_text()
    assert "Strict-Transport-Security" in middleware
    assert "max-age=31536000; includeSubDomains" in middleware
    assert "script-src 'self' 'nonce-${nonce}' 'strict-dynamic'" in middleware


def test_production_deploy_checks_readiness_and_real_hashed_asset():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert "/api/livez" in deploy
    assert "/api/readyz" in deploy
    assert "pg_dump" in deploy
    assert "alembic upgrade head" in deploy
    assert "npm ci" in deploy
    assert "_next/static" in deploy
    assert "operations-frontend" in deploy
    assert 'RELEASE="$RELEASES_DIR/$CANDIDATE_SHA"' in deploy
    assert "release-manifest.json" in deploy
    assert 'ln -sfn "$RELEASE" "$CURRENT"' in deploy
    assert "git reset --hard" not in deploy
    assert 'OPERATIONS_SMOKE_BASE="$PUBLIC_URL/api"' in deploy
    assert "OPERATIONS_EXPECTED_SHA" in deploy
    assert "wait_for_url" in deploy
    assert 'if [[ -L "$CURRENT" ]]' in deploy
    assert "trap - ERR" in deploy


def test_production_deploy_isolates_pytest_from_production_secrets():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert "-u SESSION_SECRET" in deploy
    assert "-u INTEGRATION_API_KEY" in deploy
    assert "ENVIRONMENT=local" in deploy
    assert 'TEST_DB="$(mktemp /tmp/operations-deploy-tests.' in deploy
    assert 'DATABASE_URL="sqlite:///$TEST_DB"' in deploy


def test_production_deploy_backs_up_postgresql_without_credentials_in_argv():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    helper = (REPO_ROOT / "backend" / "scripts" / "backup_postgres.py").read_text()
    assert '"$STAGING_RELEASE/backend/scripts/backup_postgres.py" "$BACKUP_FILE"' in deploy
    assert 'pg_dump --format=custom --no-owner --no-acl --dbname="$PG_DUMP_URL"' not in deploy
    assert 'url.get_backend_name() != "postgresql"' in helper
    assert 'dump_url = URL.create(' in helper
    assert 'username=url.username' in helper
    assert 'query=url.query' in helper
    assert 'child_env["PGPASSWORD"] = url.password' in helper
    assert 'child_env.pop("DATABASE_URL", None)' in helper
    assert 'os.replace(temporary, destination)' in helper



def test_deployment_validates_private_upload_and_database_archives_before_migration():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    helper = (REPO_ROOT / "scripts" / "backup_uploads.sh").read_text()
    assert '(\n  umask 077\n' in deploy
    # Applying a global restrictive umask would make built releases unreadable
    # by the non-root operations service; protect backup artifacts only.
    assert deploy.index("umask 077") > deploy.index("npm run verify")
    assert 'pg_restore --list "$BACKUP_FILE" >/dev/null' in deploy
    assert 'bash "$STAGING_RELEASE/scripts/backup_uploads.sh" "$UPLOAD_PATH" "$UPLOAD_BACKUP"' in deploy
    assert deploy.index("pg_restore --list") < deploy.index("alembic upgrade head")
    assert deploy.index("backup_uploads.sh") < deploy.index("alembic upgrade head")
    assert 'umask 077' in helper
    assert 'if [[ ! -d "$UPLOAD_PATH" ]]' in helper
    assert 'TEMP_ARCHIVE="$(mktemp ' in helper
    assert 'trap \'rm -f -- "$TEMP_ARCHIVE"\' EXIT' in helper
    assert 'tar -tzf "$TEMP_ARCHIVE" >/dev/null' in helper
    assert 'mv -f -- "$TEMP_ARCHIVE" "$DESTINATION"' in helper
    assert 'mkdir -p "$UPLOAD_PATH"' not in deploy

def test_compose_exposes_only_same_origin_gateway_and_uses_one_shot_migration():
    compose = (REPO_ROOT / "docker-compose.yml").read_text()
    assert "gateway:" in compose
    assert "migrate:" in compose
    assert "service_completed_successfully" in compose
    assert "NEXT_PUBLIC_API_BASE" not in compose
    assert compose.count("ports:") == 1


def test_operations_systemd_units_are_non_root_and_hardened():
    for name in ("operations-backend.service", "operations-frontend.service"):
        unit = (REPO_ROOT / "deployment" / "systemd" / name).read_text()
        assert "User=operations" in unit
        assert "NoNewPrivileges=true" in unit
        assert "ProtectSystem=strict" in unit
        assert "ProtectHome=true" in unit
        assert "CapabilityBoundingSet=" in unit


def test_backend_systemd_uses_relocation_safe_virtualenv_entrypoint():
    unit = (REPO_ROOT / "deployment" / "systemd" / "operations-backend.service").read_text()
    assert "/backend/.venv/bin/python -m uvicorn" in unit
    assert "/backend/.venv/bin/uvicorn" not in unit


def test_deploy_preflights_v2_credentials_before_backups_or_database_changes():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert 'source "$BACKEND_ENV"' in deploy
    assert "from app.routers.integrations_v2 import _source_keys" in deploy
    assert "sources = _source_keys()" in deploy
    assert "v2 integration credential preflight" in deploy
    assert "len(sources)" in deploy
    assert "INTEGRATION_API_KEYS_JSON" in deploy
    # Never print the JSON value: the report includes only configured count.
    assert 'echo "$INTEGRATION_API_KEYS_JSON"' not in deploy
    assert 'print(sources)' not in deploy
    assert deploy.index('source "$BACKEND_ENV"') < deploy.index("sources = _source_keys()")
    assert deploy.index("sources = _source_keys()") < deploy.index('BACKUP_STAMP=')
    assert deploy.index("sources = _source_keys()") < deploy.index("alembic upgrade head")
    # The older receiver remains usable until producers migrate to v2.
    assert "v2 source credentials not configured" in deploy



def test_env_example_survives_bash_source_with_valid_v2_integration_json():
    # A bare JSON object in a shell assignment loses its double quotes when
    # Bash sources the file, even though the same raw line is valid JSON.
    # This is the exact failure mode of the production v2 deploy preflight.
    env_path = REPO_ROOT / ".env.example"
    result = subprocess.run(
        [
            "bash",
            "-c",
            'set -e; set -a; source "$1"; python -c "$2"',
            "bash",
            str(env_path),
            (
                "import json, os; "
                'x = json.loads(os.environ["INTEGRATION_API_KEYS_JSON"]); '
                "assert isinstance(x, dict); "
                "assert set(x) == {"
                '"hidden_oasis_staff_payroll", "accounting_program", '
                '"dedicated_pos_cloud", "inventory_procurement"}; '
                'assert os.environ["BOOTSTRAP_OWNER_NAME"] == "Operations Owner"'
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    # Do not report the environment or secrets in assertion details.
    assert result.returncode == 0, "Example environment file must source cleanly and preserve v2 JSON"
