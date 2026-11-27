"""Trainer-only encrypted copies for the isolated desktop training profile."""
import json
import os
from pathlib import Path
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, SecretStr
from sqlalchemy.orm import Session
from .. import models
from ..capabilities import has_capability
from ..database import get_db
from ..training_environment import is_isolated_training
from ..training_transfer import MAX_BYTES, TransferError, export_copy, owned_learning, profile_identity, stage_copy, validate_state
from .api import require_user
from .training_practice import practice_lock

router=APIRouter(prefix='/api/training-transfer',tags=['training'])

def active_state(db):
    raw=os.environ.get('TRAINING_STATE_DIR')
    if not raw or not is_isolated_training(db):raise HTTPException(404,'Available only in the desktop training app.')
    state=Path(raw);database=Path(db.get_bind().url.database)
    try:validate_state(state,database)
    except (TransferError,ValueError,OSError):raise HTTPException(409,'Training needs trainer review before it can be copied.')
    return state,database

def trainer(user):
    if not has_capability(user.role,'manage_accounts'):raise HTTPException(403,'Ask your trainer to move this training copy.')

@router.get('/profile')
def profile(user:models.User=Depends(require_user),db:Session=Depends(get_db)):
    state,_=active_state(db)
    try:
        identity=profile_identity(state);storage={}
        saved=state/'private/restored-learning-state.json'
        if saved.exists():
            if saved.is_symlink():raise TransferError()
            restored=json.loads(saved.read_text())
            if restored.get('profile_id')!=identity['id'] or restored.get('restore_id')!=identity.get('restore_id'):raise TransferError()
            storage=owned_learning(restored.get('storage',{}),user.id)
        return {'profile_id':identity['id'],'restore_id':identity.get('restore_id'),'storage':storage}
    except (TransferError,ValueError,OSError):raise HTTPException(409,'Your training progress needs trainer review.')

class ExportRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    password:SecretStr
    learning_state:dict[str,str]

@router.post('/export')
def export(payload:ExportRequest,user:models.User=Depends(require_user),db:Session=Depends(get_db)):
    trainer(user);state,database=active_state(db)
    try:
        with practice_lock(database):content=export_copy(state,database,payload.password.get_secret_value(),payload.learning_state)
    except TransferError as exc:raise HTTPException(400,str(exc))
    return Response(content,media_type='application/octet-stream',headers={'Content-Disposition':'attachment; filename="Operations-Training.hotraining"','Cache-Control':'no-store'})

@router.post('/import')
async def import_copy(file:UploadFile=File(...),password:SecretStr=Form(...),previous_learning:str=Form(...),user:models.User=Depends(require_user),db:Session=Depends(get_db)):
    trainer(user);state,database=active_state(db)
    content=await file.read(MAX_BYTES+1025)
    try:
        previous=json.loads(previous_learning)
        with practice_lock(database):return stage_copy(state,database,password.get_secret_value(),content,previous,Path(__file__).resolve().parents[2])
    except (ValueError,TypeError) as exc:
        raise HTTPException(400,str(exc) if isinstance(exc,TransferError) else 'Could not read the training progress. No copy was opened.')
    finally:await file.close()
