from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.routers.uploads_hardened import _safe_external_url, _safe_filename, _store_upload


def test_browser_https_asset_url_is_accepted():
    assert _safe_external_url("https://cdn.example.com/assets/post-v2.jpg") == "https://cdn.example.com/assets/post-v2.jpg"


def test_external_url_rejects_non_http_scheme():
    with pytest.raises(HTTPException) as exc:
        _safe_external_url("javascript:alert(1)")
    assert exc.value.status_code == 400


def test_external_url_rejects_embedded_credentials():
    with pytest.raises(HTTPException) as exc:
        _safe_external_url("https://user:password@example.com/file.jpg")
    assert exc.value.status_code == 400


def test_dangerous_upload_extension_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _safe_filename("proof.jpg.exe")
    assert exc.value.status_code == 400


def test_unknown_upload_extension_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _safe_filename("proof.dat")
    assert exc.value.status_code == 400


def test_path_components_are_removed_from_safe_filename():
    assert _safe_filename(r"..\\folder\\proof.jpg") == "proof.jpg"


def test_upload_signature_must_match_extension(tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened

    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    upload = UploadFile(filename="proof.jpg", file=BytesIO(b"not-a-jpeg"), headers=Headers({"content-type": "image/jpeg"}))

    with pytest.raises(HTTPException) as exc:
        _store_upload(upload, "test")
    assert exc.value.status_code == 400
    assert list(tmp_path.iterdir()) == []


def test_upload_is_bounded_even_without_content_length(tmp_path, monkeypatch):
    import app.routers.uploads_hardened as hardened

    monkeypatch.setattr(hardened, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(hardened, "MAX_UPLOAD_BYTES", 4)
    upload = UploadFile(filename="proof.jpg", file=BytesIO(b"\xff\xd8\xff12345"), headers=Headers({"content-type": "image/jpeg"}))

    with pytest.raises(HTTPException) as exc:
        _store_upload(upload, "test")
    assert exc.value.status_code == 413
    assert list(tmp_path.iterdir()) == []
