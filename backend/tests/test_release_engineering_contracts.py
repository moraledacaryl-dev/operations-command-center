from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


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
    assert "127.0.0.1:3200" in deploy


def test_production_deploy_isolates_pytest_from_production_secrets():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert "-u SESSION_SECRET" in deploy
    assert "-u INTEGRATION_API_KEY" in deploy
    assert "ENVIRONMENT=local" in deploy
    assert "DATABASE_URL=sqlite:////tmp/operations-deploy-tests.db" in deploy


def test_production_deploy_normalizes_sqlalchemy_url_for_pg_dump():
    deploy = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    assert "make_url" in deploy
    assert 'url.get_backend_name() != "postgresql"' in deploy
    assert 'url.set(drivername="postgresql")' in deploy
    assert 'pg_dump --format=custom --no-owner --no-acl --dbname="$PG_DUMP_URL"' in deploy
    assert "unset PG_DUMP_URL" in deploy
