"""Complete copies retain relational records, credentials and both profiles."""
from contextlib import closing
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
from unittest.mock import patch
import pytest
from app.training_transfer import TransferError, apply_pending_copy, export_copy, owned_learning, profile_identity, stage_copy, validate_state
from test_training_existing_upgrade import old_training
ROOT=Path(__file__).resolve().parents[1]
PASSWORD='private-training-password'

@pytest.fixture
def copies(old_training):
    state,database,_=old_training
    (state/'private/desktop-settings.json').write_text('{"local_key":"source-only-settings"}')
    (state/'uploads/saved-note.txt').write_text('Saved fictional attachment')
    (state/'private/accounts/PRIVATE_TRAINER_ACCOUNTS.txt').write_text('Original private credentials')
    target=state.parent/'destination';shutil.copytree(state,target)
    (target/'private/desktop-settings.json').write_text('{"local_key":"destination-only-settings"}')
    target_db=target/'data/operations_training_demo_windesktop.sqlite'
    (target/'data'/database.name).rename(target_db)
    with closing(sqlite3.connect(target_db)) as db:
        db.execute("UPDATE saved_practice SET note='destination earlier work'");db.commit()
    return state,database,target,target_db

def contents(database):
    with closing(sqlite3.connect(database)) as db:return db.execute('SELECT note FROM saved_practice').fetchone()[0]

def test_roundtrip_keeps_records_accounts_uploads_and_original_destination(copies):
    source,db,target,target_db=copies
    progress={'ho-ops-scenario-practice-v1:1:last':'front-desk-arrival','ho-ops-scenario-practice-v1:1:guide-intro-v2':'yes','ho-ops-handbook-training-v1:1':'completed','ho-ops-structured-course-v2:1':json.dumps({'stage':'work','reference':'TRN-PROJECT-ABC12345'}),'ho-ops-room-arrivals-practice-v1:evidence:1':'{"completed":true}','ho-ops-scenario-drafts-v1:2':'{}'}
    encrypted=export_copy(source,db,PASSWORD,progress)
    assert b'Original private credentials' not in encrypted and b'TRN-PROJECT' not in encrypted
    previous={'ho-ops-structured-course-v2:1':'{"stage":"tour"}'}
    assert stage_copy(target,target_db,PASSWORD,encrypted,previous,ROOT)['ready']
    assert contents(target_db)=='destination earlier work' # never replaces an open database
    proposal=json.loads((target/'private/pending-training-transfer.json').read_text())
    assert apply_pending_copy(target,target_db)
    assert contents(target_db)=='keep this'
    assert json.loads((target/'private/desktop-settings.json').read_text())=={'local_key':'destination-only-settings'}
    archive=target.parent/proposal['archive']
    assert contents(archive/'data'/target_db.name)=='destination earlier work'
    assert json.loads((archive/'private/before-transfer-learning-state.json').read_text())==previous
    assert (target/'uploads/saved-note.txt').read_text()=='Saved fictional attachment'
    assert (target/'private/accounts/PRIVATE_TRAINER_ACCOUNTS.txt').read_text()=='Original private credentials'
    assert (target/'private/accounts/PRIVATE_training_accounts.json').read_bytes()==(source/'private/accounts/PRIVATE_training_accounts.json').read_bytes()
    assert profile_identity(target)['id']==profile_identity(source)['id']
    restored=json.loads((target/'private/restored-learning-state.json').read_text())
    assert restored['storage']==progress
    assert set(owned_learning(progress,1))==set(progress)-{'ho-ops-scenario-drafts-v1:2'}
    assert not apply_pending_copy(target,target_db)
    if os.name!='nt':assert target_db.stat().st_mode&0o077==0

@pytest.mark.parametrize('fault',['password','corrupt','future','production','real-user','bad-progress','auth-progress','pending','symlink','reserved-upload'])
def test_refusal_preserves_current_profile(copies,monkeypatch,fault):
    source,db,target,target_db=copies
    encrypted=export_copy(source,db,PASSWORD,{})
    password=PASSWORD;progress={};before=target_db.read_bytes()
    if fault=='password':password='wrong-password-here'
    if fault=='corrupt':encrypted=encrypted[:-1]+bytes([encrypted[-1]^1])
    if fault=='future':
        with closing(sqlite3.connect(db)) as con:con.execute("UPDATE alembic_version SET version_num='future_unknown'");con.commit()
        encrypted=export_copy(source,db,PASSWORD,{})
    if fault=='production':monkeypatch.setenv('ENVIRONMENT','production')
    if fault=='real-user':
        with closing(sqlite3.connect(target_db)) as con:con.execute("UPDATE users SET email='real@example.com' WHERE id=1");con.commit()
        before=target_db.read_bytes()
    if fault=='bad-progress':progress={'ho-ops-scenario-practice-v1:1:last':'front-desk-arrival','ho-ops-scenario-practice-v1:1:guide-intro-v2':'yes','ho-ops-handbook-training-v1:1':'completed','ho-ops-structured-course-v2:1':'broken'}
    if fault=='auth-progress':progress={'cc_user':'{}'}
    if fault=='pending':(target/'private/pending-training-transfer.json').write_text('{}')
    if fault=='symlink':
        (target/'uploads/saved-note.txt').unlink();(target/'uploads/saved-note.txt').symlink_to(source/'uploads/saved-note.txt')
        with pytest.raises(TransferError):export_copy(target,target_db,PASSWORD,{})
        assert target_db.read_bytes()==before;return
    if fault=='reserved-upload':
        (source/'uploads/CON.txt').write_text('bad')
        with pytest.raises(TransferError):export_copy(source,db,PASSWORD,{})
        assert target_db.read_bytes()==before;return
    with pytest.raises(TransferError):stage_copy(target,target_db,password,encrypted,progress,ROOT)
    assert target_db.read_bytes()==before
    assert not list(target.parent.glob('.destination-incoming-*'))

def test_second_import_refused_and_interrupted_activation_recovers(copies):
    source,db,target,target_db=copies;encrypted=export_copy(source,db,PASSWORD,{})
    stage_copy(target,target_db,PASSWORD,encrypted,{},ROOT)
    with pytest.raises(TransferError):stage_copy(target,target_db,PASSWORD,encrypted,{},ROOT)
    proposal=json.loads((target/'private/pending-training-transfer.json').read_text());archive=target.parent/proposal['archive']
    journal=target.parent/('.'+target.name+'-transfer-journal.json');journal.write_text(json.dumps(proposal))
    target.rename(archive)
    (target/'logs').mkdir(parents=True) # native launcher recreation after interruption
    assert apply_pending_copy(target,target_db)
    assert contents(target_db)=='keep this' and contents(archive/'data'/target_db.name)=='destination earlier work'
    assert list(target.parent.glob('destination-interrupted-*'))

def test_failed_activation_rolls_back_without_losing_either_copy(copies):
    source,db,target,target_db=copies;stage_copy(target,target_db,PASSWORD,export_copy(source,db,PASSWORD,{}),{},ROOT)
    real_replace=os.replace
    def fail_incoming(first,second):
        if Path(first).name.startswith('.destination-incoming-'):raise OSError('simulated busy directory')
        return real_replace(first,second)
    with patch('app.training_transfer.os.replace',side_effect=fail_incoming):
        with pytest.raises(OSError):apply_pending_copy(target,target_db)
    assert contents(target_db)=='destination earlier work'
    assert apply_pending_copy(target,target_db) and contents(target_db)=='keep this'

def test_corrupt_staged_identity_is_not_activated(copies):
    source,db,target,target_db=copies;stage_copy(target,target_db,PASSWORD,export_copy(source,db,PASSWORD,{}),{},ROOT)
    incoming=next(target.parent.glob('.destination-incoming-*'));profile=incoming/'private/training-profile.json'
    data=json.loads(profile.read_text());data['restore_id']='0'*32;profile.write_text(json.dumps(data))
    with pytest.raises(TransferError):apply_pending_copy(target,target_db)
    assert contents(target_db)=='destination earlier work'

def test_profile_exposes_only_current_user_and_employees_cannot_move_the_copy(old_training,monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from fastapi import HTTPException
    from app import models
    from app.routers.training_transfer import ExportRequest, export, profile
    source,db,_=old_training;monkeypatch.setenv('TRAINING_STATE_DIR',str(source))
    identity=profile_identity(source);identity['restore_id']='d'*32
    (source/'private/training-profile.json').write_text(json.dumps(identity))
    engine=create_engine('sqlite:///'+str(db))
    with Session(engine) as session:
        user=session.query(models.User).first();other=session.query(models.User).filter(models.User.id!=user.id).first()
        saved={'profile_id':identity['id'],'restore_id':identity['restore_id'],'storage':{f'ho-ops-structured-course-v2:{user.id}':'{}',f'ho-ops-structured-course-v2:{other.id}':'{"private":true}'}}
        (source/'private/restored-learning-state.json').write_text(json.dumps(saved))
        assert profile(user=user,db=session)['storage']=={f'ho-ops-structured-course-v2:{user.id}':'{}'}
        with pytest.raises(HTTPException) as refused:export(ExportRequest(password=PASSWORD,learning_state={}),user=user,db=session)
        assert refused.value.status_code==403
    engine.dispose()


def test_profile_uses_native_canonical_parent_without_following_a_linked_profile(old_training,monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from fastapi import HTTPException
    from app.routers.training_transfer import active_state
    source,database,_=old_training
    alias=source.parent.parent/(source.parent.name+'-alias')
    try:alias.symlink_to(source.parent,target_is_directory=True)
    except OSError:pytest.skip('Creating a temporary parent alias is unavailable')
    monkeypatch.setenv('TRAINING_STATE_DIR',str(alias/source.name))
    engine=create_engine('sqlite:///'+str(database))
    try:
        with Session(engine) as session:
            assert active_state(session)==(source.resolve(),database)
            linked=source.parent/'linked-profile';linked.symlink_to(source,target_is_directory=True)
            monkeypatch.setenv('TRAINING_STATE_DIR',str(linked))
            with pytest.raises(HTTPException):active_state(session)
    finally:engine.dispose()


def test_import_invalidates_prior_destination_sessions_without_changing_copied_accounts(old_training,monkeypatch):
    from app.training_transfer import restored_session_secret
    from app import session_lifecycle
    state,db,roster=old_training;before=roster.read_bytes()
    base='only-a-private-native-test-base-secret-20261128'
    assert restored_session_secret(state,base)==base
    identity=profile_identity(state);identity['restore_id']='1'*32
    (state/'private/training-profile.json').write_text(json.dumps(identity))
    first=restored_session_secret(state,base)
    assert first!=base and first==restored_session_secret(state,base)
    monkeypatch.setattr(session_lifecycle,'SESSION_SECRET',base)
    token=session_lifecycle._sign({'sub':1,'exp':9999999999})
    monkeypatch.setattr(session_lifecycle,'SESSION_SECRET',first)
    assert session_lifecycle._verify(token) is None
    identity['restore_id']='2'*32;(state/'private/training-profile.json').write_text(json.dumps(identity))
    assert restored_session_secret(state,base)!=first
    assert roster.read_bytes()==before
