from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app import models
from app.authorization_policy import scope_query
from app.main import app
from app.routers.privacy import integrations_overview, users
from app.routers.uploads_hardened import add_attachment_hardened, download_attachment
from app.user_dto import admin_user, operational_user


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", future=True)
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def seed(db):
    first = models.Department(name="Front Office")
    second = models.Department(name="Maintenance")
    db.add_all([first, second])
    db.flush()
    owner = models.User(name="Owner", email="owner@example.com", role="owner", department_id=first.id, is_active=True, password_hash="secret-hash")
    manager = models.User(name="Manager", email="manager@example.com", role="manager", department_id=first.id, is_active=True, password_hash="secret-hash")
    lead = models.User(name="Lead", email="lead@example.com", role="lead", department_id=first.id, is_active=True, password_hash="secret-hash")
    other = models.User(name="Other Lead", email="other@example.com", role="lead", department_id=second.id, is_active=True, password_hash="secret-hash")
    db.add_all([owner, manager, lead, other])
    db.flush()
    db.add_all([
        models.UserDepartment(user_id=lead.id, department_id=first.id, is_primary=True),
        models.UserDepartment(user_id=other.id, department_id=second.id, is_primary=True),
    ])
    db.commit()
    return first, second, owner, manager, lead, other


def test_explicit_user_dtos_never_expose_password_hash(db):
    _, _, owner, _, lead, _ = seed(db)
    operational = operational_user(db, lead).model_dump(mode="json")
    admin = admin_user(db, owner).model_dump(mode="json")

    assert "email" not in operational
    assert "password_hash" not in operational
    assert admin["email"] == "owner@example.com"
    assert "password_hash" not in admin


def test_sensitive_user_directory_requires_capability(db):
    _, _, owner, _, lead, _ = seed(db)
    with pytest.raises(HTTPException) as exc:
        users(active=True, q=None, limit=100, user=lead, db=db)
    assert exc.value.status_code == 403

    directory = users(active=True, q=None, limit=100, user=owner, db=db)
    assert directory
    assert all(not hasattr(item, "password_hash") for item in directory)


def test_submission_scope_excludes_other_department_and_global_for_lead(db):
    first, second, _, manager, lead, _ = seed(db)
    db.add_all([
        models.Submission(title="Mine", department_id=first.id),
        models.Submission(title="Other", department_id=second.id),
        models.Submission(title="Global", department_id=None),
    ])
    db.commit()

    lead_rows = scope_query(db, lead, models.Submission, db.query(models.Submission)).order_by(models.Submission.id).all()
    assert [row.title for row in lead_rows] == ["Mine"]

    manager_rows = scope_query(db, manager, models.Submission, db.query(models.Submission)).order_by(models.Submission.id).all()
    assert [row.title for row in manager_rows] == ["Mine", "Other", "Global"]


def test_integration_overview_requires_explicit_capability(db):
    _, _, _, manager, lead, _ = seed(db)
    with pytest.raises(HTTPException) as exc:
        integrations_overview(user=lead, db=db)
    assert exc.value.status_code == 403
    assert integrations_overview(user=manager, db=db)["pending_review_count"] == 0


def test_public_upload_static_mount_is_removed():
    assert all(getattr(route, "path", None) != "/uploads" for route in app.routes)


def test_cross_department_attachment_download_is_denied(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened

    first, _, owner, _, lead, other = seed(db)
    task = models.Task(title="Scoped file", department_id=first.id)
    db.add(task)
    db.flush()
    stored = tmp_path / "proof.pdf"
    stored.write_bytes(b"%PDF-1.7\nproof")
    attachment = models.Attachment(
        parent_type="tasks",
        parent_id=task.id,
        filename="proof.pdf",
        file_url="storage:proof.pdf",
        mime_type="application/pdf",
        uploaded_by_id=owner.id,
    )
    db.add(attachment)
    db.commit()
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)

    response = download_attachment(attachment.id, user=lead, db=db)
    assert Path(response.path) == stored

    with pytest.raises(HTTPException) as exc:
        download_attachment(attachment.id, user=other, db=db)
    assert exc.value.status_code == 403


def test_post_version_number_is_unique_in_database(db):
    first, _, owner, _, _, _ = seed(db)
    post = models.Post(title="Campaign", department_id=first.id)
    db.add(post)
    db.flush()
    db.add(models.PostVersion(post_id=post.id, version_no=1, filename="one.pdf", uploaded_by_id=owner.id))
    db.commit()

    db.add(models.PostVersion(post_id=post.id, version_no=1, filename="duplicate.pdf", uploaded_by_id=owner.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_missing_historical_version_is_visible_without_misleading_link_or_data_repair(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened

    first, _, owner, _, lead, other = seed(db)
    post = models.Post(title="Historical creative", department_id=first.id)
    db.add(post); db.flush()
    version = models.PostVersion(post_id=post.id, version_no=1, filename="historic.png",
                                 file_url="storage:historic.png", note="Original evidence", uploaded_by_id=owner.id)
    db.add(version); db.commit()
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)

    result = hardened.list_post_versions_hardened(post.id, user=lead, db=db)
    assert len(result) == 1
    assert result[0]["file_status"] == "unavailable"
    assert result[0]["file_url"] is None
    assert result[0]["note"] == "Original evidence"
    with pytest.raises(HTTPException) as exc:
        hardened.download_post_version(post.id, version.id, user=lead, db=db)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        hardened.list_post_versions_hardened(post.id, user=other, db=db)
    assert exc.value.status_code == 403
    db.expire_all()
    assert db.get(models.PostVersion, version.id).file_url == "storage:historic.png"
    assert db.query(models.PostVersion).count() == 1

    # Restoring the authentic original later is reflected without altering history.
    (tmp_path / "historic.png").write_bytes(b"original")
    restored = hardened.list_post_versions_hardened(post.id, user=lead, db=db)[0]
    assert restored["file_status"] == "available"
    assert restored["file_url"] == f"/api/posts/{post.id}/versions/{version.id}/download"


@pytest.mark.parametrize("url,status", [(None, "none"), ("https://example.test/creative.png", "external"), ("storage:../outside.png", "unavailable")])
def test_historical_version_status_does_not_probe_external_urls_or_expose_storage_paths(url, status, monkeypatch, tmp_path):
    import app.routers.uploads_hardened as hardened

    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    version = models.PostVersion(id=7, post_id=3, version_no=1, filename="creative.png", file_url=url)
    response = hardened._version_response(version)
    assert response["file_status"] == status
    assert response["file_url"] == ("/api/posts/3/versions/7/download" if status == "external" else None)


def test_failed_attachment_commit_removes_stored_file(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened

    first, _, owner, _, _, _ = seed(db)
    task = models.Task(title="Cleanup", department_id=first.id)
    db.add(task)
    db.commit()
    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)

    upload = UploadFile(
        filename="proof.pdf",
        file=BytesIO(b"%PDF-1.7\ncleanup"),
        headers=Headers({"content-type": "application/pdf"}),
    )

    def fail_commit():
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulated database failure"):
        add_attachment_hardened(
            resource="tasks",
            item_id=task.id,
            filename="",
            file_url="",
            mime_type="",
            file=upload,
            user=owner,
            db=db,
        )
    assert list(tmp_path.iterdir()) == []
