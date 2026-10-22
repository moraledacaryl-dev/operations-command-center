"""Versioned integration identity links cannot silently switch employee ownership."""

import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base
from app.integration_models import ExternalUserIdentity
from app.routers.integrations_v2 import IdentityLinkPayload, link_identity


@pytest.fixture()
def context(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("INTEGRATION_API_KEYS_JSON", json.dumps({
        "hidden_oasis_staff_payroll": "staff-private-key",
        "accounting_program": "accounting-private-key",
    }))
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    dept = models.Department(name="Operations")
    db.add(dept)
    db.flush()
    alice = models.User(
        name="Alice", email="alice@example.test", role="staff",
        department_id=dept.id, is_active=True,
    )
    bob = models.User(
        name="Bob", email="bob@example.test", role="staff",
        department_id=dept.id, is_active=True,
    )
    db.add_all([alice, bob])
    db.commit()
    try:
        yield db, alice, bob
    finally:
        db.close()
        engine.dispose()


def link(db, source, key, identity, *, user_id=None, email=None, name=None, status="active"):
    return link_identity(
        source,
        IdentityLinkPayload(
            external_user_id=identity,
            operations_user_id=user_id,
            email=email,
            display_name=name,
            status=status,
        ),
        x_integration_api_key=key,
        db=db,
    )


def test_first_link_and_same_user_metadata_update_preserve_identity(context):
    db, alice, _ = context
    created = link(
        db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009",
        user_id=alice.id, name="Alice Staff",
    )
    assert created.status == "created"
    row = db.query(ExternalUserIdentity).one()
    original_id = row.id
    first_seen = row.first_seen_at

    updated = link(
        db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009",
        user_id=alice.id, name="Alice Updated", status="inactive",
    )
    assert updated.status == "updated"
    db.refresh(row)
    assert row.id == original_id
    assert row.user_id == alice.id
    assert row.external_name == "Alice Updated"
    assert row.status == "inactive"
    assert row.first_seen_at == first_seen
    assert db.query(ExternalUserIdentity).count() == 1


def test_existing_external_id_cannot_be_reassigned_to_different_user(context):
    db, alice, bob = context
    link(
        db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009",
        user_id=alice.id, name="Original identity",
    )
    row = db.query(ExternalUserIdentity).one()
    recorded = (row.id, row.user_id, row.external_name, row.status, row.last_seen_at)

    with pytest.raises(HTTPException) as exc:
        link(
            db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009",
            user_id=bob.id, name="Spoofed remap",
        )
    assert exc.value.status_code == 409
    db.commit()  # A later commit cannot accidentally persist a rejected change.
    db.refresh(row)
    assert (row.id, row.user_id, row.external_name, row.status, row.last_seen_at) == recorded
    assert db.query(ExternalUserIdentity).count() == 1


def test_email_based_rebinding_is_also_rejected(context):
    db, alice, bob = context
    link(db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009", user_id=alice.id)
    with pytest.raises(HTTPException) as exc:
        link(
            db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009",
            email=bob.email,
        )
    assert exc.value.status_code == 409
    assert db.query(ExternalUserIdentity).one().user_id == alice.id


def test_same_external_id_in_other_source_is_independent(context):
    db, alice, bob = context
    link(db, "hidden_oasis_staff_payroll", "staff-private-key", "100", user_id=alice.id)
    result = link(db, "accounting_program", "accounting-private-key", "100", user_id=bob.id)
    assert result.status == "created"
    rows = db.query(ExternalUserIdentity).order_by(ExternalUserIdentity.source_app).all()
    assert len(rows) == 2
    assert {r.source_app: r.user_id for r in rows} == {
        "accounting_program": bob.id,
        "hidden_oasis_staff_payroll": alice.id,
    }


def test_wrong_source_credential_does_not_write_identity(context):
    db, alice, _ = context
    with pytest.raises(HTTPException) as exc:
        link(db, "accounting_program", "staff-private-key", "100", user_id=alice.id)
    assert exc.value.status_code == 401
    assert db.query(ExternalUserIdentity).count() == 0


def test_duplicate_insert_race_is_conflict_not_server_error(context, monkeypatch):
    db, alice, _ = context
    original_commit = db.commit

    def conflicting_commit():
        raise IntegrityError("INSERT INTO external_user_identities", {}, Exception("unique key"))

    monkeypatch.setattr(db, "commit", conflicting_commit)
    with pytest.raises(HTTPException) as exc:
        link(db, "hidden_oasis_staff_payroll", "staff-private-key", "EMP-009", user_id=alice.id)
    assert exc.value.status_code == 409
    assert "concurrently" in str(exc.value.detail)
    monkeypatch.setattr(db, "commit", original_commit)
    assert db.query(ExternalUserIdentity).count() == 0
