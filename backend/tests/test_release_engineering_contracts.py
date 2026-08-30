import ast
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


def test_production_deploy_isolates_pytest_from_production_secrets():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert "-u SESSION_SECRET" in deploy
    assert "-u INTEGRATION_API_KEY" in deploy
    assert "ENVIRONMENT=local" in deploy
    assert 'TEST_DB="$(mktemp /tmp/operations-deploy-tests.' in deploy
    assert 'DATABASE_URL="sqlite:///$TEST_DB"' in deploy


def test_production_deploy_normalizes_sqlalchemy_url_for_pg_dump():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert "make_url" in deploy
    assert 'url.get_backend_name() != "postgresql"' in deploy
    assert 'url.set(drivername="postgresql")' in deploy
    assert 'pg_dump --format=custom --no-owner --no-acl --dbname="$PG_DUMP_URL"' in deploy
    assert "unset PG_DUMP_URL" in deploy


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
