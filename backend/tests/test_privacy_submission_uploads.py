from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import models
from app.authorization_policy import scope_query
from app.routers.privacy import integrations_overview
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


def test_cross_department_attachment_download_is_denied(db, tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened

    first, second, owner, _, lead, other = seed(db)
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
    assert response.path == str(stored)

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
        headers={"content-type": "application/pdf"},
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
