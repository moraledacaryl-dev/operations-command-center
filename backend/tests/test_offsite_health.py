import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import models
from app.database import get_db
from app.routers import observability
from app.routers.api import require_user


def client_for(user=None):
    app = FastAPI()
    app.include_router(observability.router)
    app.dependency_overrides[get_db] = lambda: None
    if user is not None:
        app.dependency_overrides[require_user] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize('role,allowed', [('owner',True),('admin',True),('manager',True),('lead',False),('supervisor',False),('staff',False),('unknown',False)])
def test_only_health_roles_can_read_offsite_aggregates_without_leaking_secrets(tmp_path, monkeypatch, role, allowed):
    path=tmp_path/'status.json'
    path.write_text(json.dumps({'last_attempt_status':'ok','last_success_at':datetime.now(timezone.utc).isoformat(),'last_success_release':'a'*40,
                                'password':'must never escape','repository':'private endpoint','source_payload':'private business data'}))
    monkeypatch.setattr(observability,'OFFSITE_STATUS_PATH',path)
    with client_for(models.User(id=1,role=role,is_active=True)) as client:
        response=client.get('/api/recovery/offsite?role=owner')
    assert response.status_code==(200 if allowed else 403)
    if allowed:
        assert response.json()['status']=='current'
        assert set(response.json())=={'status','last_success_at','last_attempt_status'}
    assert all(secret not in response.text for secret in ['must never escape','private endpoint','private business data'])


def test_anonymous_request_is_denied_before_reading_status(monkeypatch):
    def forbidden(*args,**kwargs):
        pytest.fail('Anonymous request must not reach the status reader')
    monkeypatch.setattr(observability,'backup_status',forbidden)
    with client_for() as client:
        assert client.get('/api/recovery/offsite').status_code==401


@pytest.mark.parametrize('state,expected', [('failed','failed'),('stale','stale'),('missing','unknown')])
def test_offsite_failure_or_missing_file_does_not_look_current(tmp_path,monkeypatch,state,expected):
    path=tmp_path/'status.json'
    if state!='missing':
        when=datetime.now(timezone.utc)-timedelta(hours=3 if state=='stale' else 0)
        path.write_text(json.dumps({'last_attempt_status':'failed' if state=='failed' else 'ok','last_success_at':when.isoformat(),'last_success_release':'a'*40}))
    monkeypatch.setattr(observability,'OFFSITE_STATUS_PATH',path)
    with client_for(models.User(id=1,role='owner',is_active=True)) as client:
        assert client.get('/api/recovery/offsite').json()['status']==expected


def test_private_offsite_route_precedes_generic_resource_routes():
    from app.main import app
    paths=[getattr(route,'path',None) for route in app.routes]
    assert paths.count('/api/recovery/offsite')==1
    assert paths.index('/api/recovery/offsite')<paths.index('/api/{resource}/{item_id}')
