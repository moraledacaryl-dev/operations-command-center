from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.write_contract import WriteContractMiddleware


def build_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(WriteContractMiddleware)

    @app.post('/api/{resource}/{item_id}/status')
    def generic_status(resource: str, item_id: int):
        if resource in {'requests', 'fixes'}:
            raise HTTPException(status_code=405, detail='Use the canonical workflow endpoint.')
        return {'resource': resource, 'item_id': item_id}

    return app


def test_request_generic_status_reaches_canonical_405_guard():
    client = TestClient(build_app())
    response = client.post('/api/requests/1/status', json={'status': 'Approved'})
    assert response.status_code == 405
    assert response.json()['detail'] == 'Use the canonical workflow endpoint.'


def test_fix_generic_status_reaches_canonical_405_guard():
    client = TestClient(build_app())
    response = client.post('/api/fixes/1/status', json={'status': 'Verified'})
    assert response.status_code == 405
    assert response.json()['detail'] == 'Use the canonical workflow endpoint.'


def test_non_workflow_status_validation_still_rejects_invalid_value():
    client = TestClient(build_app())
    response = client.post('/api/tasks/1/status', json={'status': 'Bogus'})
    assert response.status_code == 422
