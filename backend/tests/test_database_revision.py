import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text


@pytest.mark.parametrize('heads,expected', [([], 'unversioned'),(['0002_integration_identity'],'0002_integration_identity'),(['0002_integration_identity','0011_project_collaboration'],None)])
def test_database_revision_records_the_existing_schema_not_the_code_head(monkeypatch, heads, expected):
    path=Path(__file__).resolve().parents[1]/'scripts/database_revision.py'
    spec=importlib.util.spec_from_file_location('revision_reader',path)
    reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    engine=create_engine('sqlite:///:memory:')
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE alembic_version (version_num VARCHAR(64) NOT NULL)'))
        for head in heads:conn.execute(text('INSERT INTO alembic_version VALUES (:head)'),{'head':head})
    monkeypatch.setattr(reader,'engine',engine)
    if expected is None:
        with pytest.raises(ValueError):reader.database_revision()
    else:assert reader.database_revision()==expected
    engine.dispose()
