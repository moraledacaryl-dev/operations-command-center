"""The provided colleague cases use actual request/approval workflows and keep decisions."""
import pytest
from fastapi import HTTPException
from app import models
from app.routers.training_practice import ReviewStart, review_case
from app.services.approval_workflow import decide_approval
from test_training_existing_upgrade import old_training

@pytest.fixture
def reviewers(old_training):
    from app.database import SessionLocal
    with SessionLocal() as db:
        department=models.Department(name='Front Desk',short_name='FD');db.add(department);db.flush()
        owner=db.query(models.User).filter_by(email='owner@training.invalid').one();owner.role='owner';owner.department_id=department.id
        colleague=db.query(models.User).filter_by(email='frontdesk-lead@training.invalid').one();colleague.role='lead';colleague.department_id=department.id
        db.add_all([models.UserDepartment(user_id=owner.id,department_id=department.id,is_primary=True),models.UserDepartment(user_id=colleague.id,department_id=department.id,is_primary=True)])
        db.commit();yield db,owner,department

def test_cases_are_colleague_owned_idempotent_and_keep_saved_decisions(reviewers):
    db,owner,department=reviewers
    payload=ReviewStart(reference='TRN-DECISION-ABC12345',department_id=department.id)
    pair=review_case(payload,user=owner,db=db)
    missing=db.get(models.Approval,pair['record_id']);supported=db.get(models.Approval,pair['related_record_id'])
    assert missing.requested_by_id!=owner.id and supported.requested_by_id!=owner.id
    assert missing.source_type==supported.source_type=='ops_need'
    assert 'missing' in db.get(models.Request,missing.source_id).reason.lower()
    assert 'checked' in db.get(models.Request,supported.source_id).reason.lower()
    decide_approval(db,owner,missing.id,'Rejected','Supplier quote is missing.')
    decide_approval(db,owner,supported.id,'Approved','Supplier quote was checked.')
    again=review_case(payload,user=owner,db=db)
    assert again==pair and db.query(models.Request).count()==2 and db.query(models.Approval).count()==2
    db.expire_all()
    assert db.get(models.Approval,missing.id).status=='Rejected'
    assert db.get(models.Request,missing.source_id).status=='Rejected'
    assert db.get(models.Approval,supported.id).status=='Approved'
    assert db.get(models.Request,supported.source_id).status=='Approved'
    fresh=review_case(ReviewStart(reference='TRN-DECISION-ABC12346',department_id=department.id),user=owner,db=db)
    assert fresh['record_id']!=pair['record_id']
    assert db.get(models.Approval,missing.id).status=='Rejected'

@pytest.mark.parametrize('fault',['production','nonfictional','scope'])
def test_case_preparation_refuses_invalid_boundaries_without_writing(reviewers,monkeypatch,fault):
    db,user,department=reviewers
    if fault=='production':monkeypatch.setenv('ENVIRONMENT','production')
    elif fault=='nonfictional':db.add(models.User(name='Do not modify',email='person@example.com',role='staff',is_active=True));db.commit()
    else:user.role='staff';db.commit()
    with pytest.raises(HTTPException):review_case(ReviewStart(reference='TRN-DECISION-ABC12347',department_id=department.id),user=user,db=db)
    assert db.query(models.Request).count()==db.query(models.Approval).count()==0
