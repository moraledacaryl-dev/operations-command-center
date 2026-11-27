"""Encrypted, complete fictional training copies; never merge unrelated databases."""
from __future__ import annotations
from datetime import datetime,timezone
from contextlib import closing
import ast
import hashlib
import io
import json
import os
from pathlib import Path,PurePosixPath
import re
import secrets
import shutil
import sqlite3
import stat
import tempfile
import time
import zipfile
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC=b'HIDDEN-OASIS-OPS-TRAINING-COPY\x00V1\x00'
MAX_BYTES=128*1024*1024
MAX_LEARNING=2*1024*1024
PREFIXES=('ho-ops-structured-course-v2:','ho-ops-training-complete-v1:','ho-ops-verified-workflow-v1:','ho-ops-workflow-results-v1:','ho-ops-scenario-practice-v1:','ho-ops-scenario-drafts-v1:','ho-training-room-mission-v1:','ho-training-shift-mission-v1:','ho-independent-shift-v1:','ho-ops-task-inspection-v1:','ho-ops-handover-inspection-v1:','ho-ops-guest-inspection-v1:','ho-ops-fix-inspection-v1:','ho-ops-notification-read-v1:','ho-ops-local-trainer-reports-v1:','ho-ops-room-arrivals-practice-v1:evidence:','ho-ops-room-arrivals-practice-v1:','ho-ops-handbook-training-v1:')
ACCOUNTS={'PRIVATE_training_accounts.json','training_manifest.json','PRIVATE_TRAINER_ACCOUNTS.txt'}

class TransferError(ValueError):pass

def _refuse(message='This training copy could not be opened. Ask your trainer for help.'):
    raise TransferError(message)

def _private_json(path:Path,value):
    if path.is_symlink():_refuse()
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    pending=path.with_name(path.name+'.'+secrets.token_hex(6)+'.pending')
    fd=os.open(pending,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as out:
            json.dump(value,out,separators=(',',':'));out.flush();os.fsync(out.fileno())
        os.replace(pending,path)
    finally:pending.unlink(missing_ok=True)

def learning_state(value):
    if not isinstance(value,dict) or len(value)>2000:_refuse('The training progress file is too large.')
    clean={}
    for key,data in value.items():
        if not isinstance(key,str) or not key.startswith(PREFIXES) or len(key)>200 or not isinstance(data,str) or len(data)>250000:_refuse('The file contains unsupported training progress.')
        auxiliary=(key.startswith('ho-ops-scenario-practice-v1:') and ((key.endswith(':last') and re.fullmatch(r'[a-z0-9-]{1,100}',data)) or (key.endswith(':guide-intro-v2') and data=='yes'))) or (key.startswith('ho-ops-handbook-training-v1:') and data=='completed')
        if not auxiliary:
            try:json.loads(data)
            except (ValueError,TypeError):_refuse('The file contains unreadable training progress.')
        clean[key]=data
    if len(json.dumps(clean).encode())>MAX_LEARNING:_refuse('The training progress file is too large.')
    return clean

def owned_learning(value,user_id):
    clean=learning_state(value)
    result={}
    for key,data in clean.items():
        for prefix in PREFIXES:
            if key.startswith(prefix):
                suffix=key[len(prefix):]
                if suffix==str(user_id) or suffix.startswith(str(user_id)+':'):result[key]=data
                break
    return result

def profile_identity(state:Path):
    path=state/'private/training-profile.json'
    if not path.exists():
        path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        try:
            fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,'w',encoding='utf-8') as out:json.dump({'id':secrets.token_hex(16)},out)
        except FileExistsError:pass
    if path.is_symlink():_refuse()
    value=json.loads(path.read_text())
    if not isinstance(value,dict) or not re.fullmatch(r'[0-9a-f]{32}',str(value.get('id',''))):_refuse()
    return value

def validate_state(state:Path,database:Path):
    if os.environ.get('ENVIRONMENT','').lower() not in {'local','test'}:_refuse('Training copies are available only in Operations Training.')
    if not state.is_absolute() or database.parent!=state/'data' or not database.name.startswith('operations_training_demo_') or database.suffix!='.sqlite':_refuse()
    for path in [state,database,state/'private',state/'private/accounts',state/'uploads',state/'data/.initialized']:
        if path.is_symlink() or any(p.is_symlink() for p in path.parents):_refuse()
    if not database.is_file() or not (state/'data/.initialized').is_file():_refuse()
    roster=state/'private/accounts/PRIVATE_training_accounts.json'
    if roster.is_symlink() or not roster.is_file():_refuse()
    data=json.loads(roster.read_text());accounts=data.get('accounts',[])
    if data.get('synthetic') is not True or not accounts:_refuse()
    expected={item.get('email') for item in accounts if isinstance(item,dict)}
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        emails={row[0] for row in db.execute('SELECT email FROM users')}
        if not expected.issubset(emails) or any(not isinstance(email,str) or not email.endswith('@training.invalid') for email in emails):_refuse()
        if db.execute('PRAGMA quick_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchone():_refuse('The training data needs review. Ask your trainer for help.')
        revisions=[row[0] for row in db.execute('SELECT version_num FROM alembic_version')]
    if not revisions:_refuse()
    return revisions

def supported_revisions(backend:Path):
    revisions=set()
    for path in (backend/'alembic/versions').glob('*.py'):
        tree=ast.parse(path.read_text())
        for node in tree.body:
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='revision' for t in node.targets) and isinstance(node.value,ast.Constant):revisions.add(node.value.value)
            elif isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name) and node.target.id=='revision' and isinstance(node.value,ast.Constant):revisions.add(node.value.value)
    return revisions

def _path(name):
    path=PurePosixPath(name)
    reserved={'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}
    if any(part.rstrip(' .')!=part or part.split('.')[0].upper() in reserved for part in path.parts):_refuse()
    if not name or name!=path.as_posix() or path.is_absolute() or '..' in path.parts or '\\' in name or any(any(c in part for c in '\x00<>:"|?*') for part in path.parts):_refuse()
    return path

def export_copy(state:Path,database:Path,password:str,progress:dict):
    if len(password.strip())<12 or len(password)>200:_refuse('Use a password with at least 12 characters.')
    revisions=validate_state(state,database)
    progress=learning_state(progress);identity=profile_identity(state)
    files={};total=0
    def add(name,path):
        nonlocal total
        total+=path.stat().st_size
        if total>MAX_BYTES:_refuse('This training copy is too large. Ask your trainer for help.')
        files[name]=path.read_bytes()
    with tempfile.TemporaryDirectory(prefix='training-copy-',dir=state/'private') as directory:
        snapshot=Path(directory)/'snapshot.sqlite';snapshot.touch(mode=0o600)
        start=time.monotonic()
        def tick(*_):
            if time.monotonic()-start>30:_refuse('Training is busy. Please try saving the copy again.')
        with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as source,closing(sqlite3.connect(snapshot)) as target:source.backup(target,pages=128,progress=tick,sleep=.02)
        with closing(sqlite3.connect(snapshot)) as check:
            if check.execute('PRAGMA quick_check').fetchone()[0]!='ok' or check.execute('PRAGMA foreign_key_check').fetchone():_refuse()
            if any(not row[0].endswith('@training.invalid') for row in check.execute('SELECT email FROM users')):_refuse()
            revisions=[row[0] for row in check.execute('SELECT version_num FROM alembic_version')]
        add('data/operations.sqlite',snapshot)
    add('data/.initialized',state/'data/.initialized')
    for name in ACCOUNTS:
        path=state/'private/accounts'/name
        if path.is_symlink():_refuse()
        if path.is_file():add('private/accounts/'+name,path)
    for path in (state/'uploads').rglob('*'):
        if path.is_symlink():_refuse()
        if path.is_file():add('uploads/'+path.relative_to(state/'uploads').as_posix(),path)
    files['learning-state.json']=json.dumps(progress,separators=(',',':')).encode()
    if sum(map(len,files.values()))>MAX_BYTES:_refuse('This training copy is too large. Ask your trainer for help.')
    names=set()
    for name in files:
        _path(name)
        if name.casefold() in names:_refuse('Some training files have conflicting names. Ask your trainer for help.')
        names.add(name.casefold())
    manifest={'format':'hidden-oasis-complete-training-v1','profile_id':identity['id'],'created_at':datetime.now(timezone.utc).isoformat(),'revisions':revisions,'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,data in files.items():archive.writestr(name,data)
        archive.writestr('manifest.json',json.dumps(manifest,separators=(',',':')))
    if len(output.getvalue())>MAX_BYTES:_refuse('This training copy is too large. Ask your trainer for help.')
    salt=secrets.token_bytes(16);nonce=secrets.token_bytes(12);header=MAGIC+salt+nonce
    key=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,600000,32)
    return header+AESGCM(key).encrypt(nonce,output.getvalue(),header)

def stage_copy(state:Path,database:Path,password:str,encrypted:bytes,previous_learning:dict,backend:Path):
    validate_state(state,database);previous_learning=learning_state(previous_learning)
    pending=state/'private/pending-training-transfer.json'
    if pending.exists():_refuse('A training copy is ready to open. Close the app and reopen it first.')
    if not 12<=len(password)<=200 or len(encrypted)>MAX_BYTES+1024 or not encrypted.startswith(MAGIC):_refuse('Check the training copy and its password.')
    offset=len(MAGIC);salt=encrypted[offset:offset+16];nonce=encrypted[offset+16:offset+28];header=encrypted[:offset+28]
    try:
        key=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,600000,32)
        plain=AESGCM(key).decrypt(nonce,encrypted[offset+28:],header)
    except (InvalidTag,ValueError):_refuse('This training copy could not be opened. Check the password and file.')
    if len(plain)>MAX_BYTES:_refuse()
    try:
        with zipfile.ZipFile(io.BytesIO(plain)) as archive:
            entries=archive.infolist();names=[entry.filename for entry in entries]
            if len(entries)>10000 or len(set(n.casefold() for n in names))!=len(names) or sum(entry.file_size for entry in entries)>MAX_BYTES:_refuse()
            for entry in entries:
                _path(entry.filename)
                if stat.S_ISLNK(entry.external_attr>>16) or entry.is_dir():_refuse()
                if not (entry.filename in {'manifest.json','learning-state.json','data/operations.sqlite','data/.initialized'} or entry.filename.startswith('uploads/') or entry.filename.startswith('private/accounts/') and PurePosixPath(entry.filename).name in ACCOUNTS):_refuse()
            manifest=json.loads(archive.read('manifest.json'))
            if manifest.get('format')!='hidden-oasis-complete-training-v1' or not re.fullmatch(r'[0-9a-f]{32}',manifest.get('profile_id','')):_refuse()
            if not set(manifest.get('revisions',[])) or not set(manifest['revisions']).issubset(supported_revisions(backend)):_refuse('Update Operations Training before opening this copy.')
            expected=manifest.get('files',{})
            if set(names)!={'manifest.json',*expected} or not {'data/operations.sqlite','data/.initialized','private/accounts/PRIVATE_training_accounts.json','learning-state.json'}.issubset(expected):_refuse()
            content={name:archive.read(name) for name in expected}
            if any(hashlib.sha256(data).hexdigest()!=expected[name] for name,data in content.items()):_refuse()
            progress=learning_state(json.loads(content.pop('learning-state.json')))
    except (zipfile.BadZipFile,KeyError,TypeError,json.JSONDecodeError,UnicodeDecodeError):_refuse('This training copy is incomplete or damaged.')
    token=secrets.token_hex(16)
    incoming=state.parent/('.'+state.name+'-incoming-'+token)
    incoming.mkdir(mode=0o700)
    try:
        for name,data in content.items():
            destination=incoming/('data/'+database.name if name=='data/operations.sqlite' else name)
            destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as out:out.write(data)
        (incoming/'uploads').mkdir(mode=0o700,exist_ok=True)
        revisions=validate_state(incoming,incoming/'data'/database.name)
        if sorted(revisions)!=sorted(manifest['revisions']):_refuse()
        _private_json(incoming/'private/training-profile.json',{'id':manifest['profile_id'],'restore_id':token})
        _private_json(incoming/'private/restored-learning-state.json',{'profile_id':manifest['profile_id'],'restore_id':token,'storage':progress})
        _private_json(state/'private/before-transfer-learning-state.json',previous_learning)
        proposal={'format':1,'incoming':incoming.name,'archive':state.name+'-previous-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+token[:8],'profile_id':manifest['profile_id'],'restore_id':token,'database':database.name}
        _private_json(pending,proposal)
    except BaseException:
        shutil.rmtree(incoming);raise
    return {'ready':True,'message':'Training copy ready. Close this app, then open it again.'}

def apply_pending_copy(state:Path,database:Path):
    """Called by the native initializer before opening any operational SQLite engine."""
    journal=state.parent/('.'+state.name+'-transfer-journal.json')
    pending=state/'private/pending-training-transfer.json'
    source=journal if journal.exists() else pending
    if not source.exists():return False
    if source.is_symlink() or state.is_symlink():_refuse()
    item=json.loads(source.read_text())
    token=item.get('restore_id','')
    if item.get('format')!=1 or not re.fullmatch(r'[0-9a-f]{32}',token) or item.get('incoming')!='.'+state.name+'-incoming-'+token or item.get('database')!=database.name or not re.fullmatch(re.escape(state.name)+r'-previous-\d{8}T\d{6}-'+token[:8],item.get('archive','')):_refuse()
    incoming=state.parent/item['incoming'];archive=state.parent/item['archive']
    if incoming.is_symlink() or archive.is_symlink():_refuse()
    if archive.exists() and (state/'private/training-profile.json').is_file():
        identity=profile_identity(state)
        if identity.get('restore_id')==token:
            validate_state(state,database);journal.unlink(missing_ok=True);return True
    validate_state(incoming,incoming/'data'/database.name)
    identity=profile_identity(incoming)
    if identity.get('id')!=item.get('profile_id') or identity.get('restore_id')!=token:_refuse()
    if not journal.exists():_private_json(journal,item)
    if not archive.exists():os.replace(state,archive)
    elif state.exists():
        # A launcher may have recreated only its empty startup directories after
        # a power loss. Preserve them, and never replace a usable database.
        if database.exists() or (state/'data/.initialized').exists() or (state/'private/accounts').exists():_refuse('An earlier transfer needs trainer review. Your existing copies are kept.')
        os.replace(state,state.parent/(state.name+'-interrupted-'+secrets.token_hex(8)))
    try:os.replace(incoming,state)
    except BaseException:
        if not state.exists() and archive.exists():os.replace(archive,state)
        raise
    if (archive/'private/pending-training-transfer.json').exists():os.replace(archive/'private/pending-training-transfer.json',archive/'private/applied-training-transfer.json')
    journal.unlink(missing_ok=True)
    return True
