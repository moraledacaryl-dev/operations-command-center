from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.write_contract import WriteContractMiddleware


def make_client() -> TestClient:
    app = FastAPI()
    app.add_middleware(WriteContractMiddleware)

    @app.post('/api/tasks')
    def create_task(payload: dict):
        return payload

    @app.patch('/api/tasks/{item_id}')
    def update_task(item_id: int, payload: dict):
        return {'id': item_id, **payload}

    @app.post('/api/tasks/{item_id}/status')
    def task_status(item_id: int, payload: dict):
        return {'id': item_id, **payload}

    @app.post('/api/fixes/{item_id}/status')
    def fix_status(item_id: int, payload: dict):
        return {'id': item_id, **payload}

    @app.post('/api/requests/{item_id}/status')
    def request_status(item_id: int, payload: dict):
        return {'id': item_id, **payload}

    @app.patch('/api/requests/{item_id}')
    def update_request(item_id: int, payload: dict):
        return {'id': item_id, **payload}

    return TestClient(app)


def test_empty_task_is_rejected_before_persistence():
    response = make_client().post('/api/tasks', json={})
    assert response.status_code == 422
    assert 'Title is required' in response.json()['detail']


def test_unknown_task_field_is_rejected():
    response = make_client().post('/api/tasks', json={'title': 'Check room', 'titel': 'typo'})
    assert response.status_code == 422
    assert 'titel' in response.json()['detail']


def test_invalid_status_is_rejected():
    response = make_client().post('/api/tasks/12/status', json={'status': 'Whatever'})
    assert response.status_code == 422
    assert 'Invalid status' in response.json()['detail']


def test_valid_task_write_passes_contract():
    response = make_client().post('/api/tasks', json={'title': 'Check room', 'status': 'To Do'})
    assert response.status_code == 200
    assert response.json()['title'] == 'Check room'


def test_fix_cannot_bypass_verification_workflow():
    response = make_client().post('/api/fixes/9/status', json={'status': 'Verified'})
    assert response.status_code == 422
    assert 'Invalid status' in response.json()['detail']


def test_request_cannot_be_approved_through_generic_status():
    response = make_client().post('/api/requests/4/status', json={'status': 'Approved'})
    assert response.status_code == 422
    assert 'linked Approval workflow' in response.json()['detail']


def test_request_cannot_be_rejected_through_generic_patch():
    response = make_client().patch('/api/requests/4', json={'status': 'Rejected'})
    assert response.status_code == 422
    assert 'linked Approval workflow' in response.json()['detail']


def test_request_non_decision_status_still_allowed():
    response = make_client().post('/api/requests/4/status', json={'status': 'Planned'})
    assert response.status_code == 200
    assert response.json()['status'] == 'Planned'
