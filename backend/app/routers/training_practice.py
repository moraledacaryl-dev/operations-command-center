"""Fictional colleague requests for the isolated training course only."""
from __future__ import annotations
from contextlib import contextmanager
import os
from pathlib import Path
import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from .. import models
from ..authorization_policy import Action, authorize_action
from ..database import get_db
from ..services.request_workflow import submit_request
from ..training_environment import is_isolated_training
from .api import require_user
from .authorized_crud import create_resource_authorized

router=APIRouter(prefix='/api/training-practice',tags=['training'])

@contextmanager
def practice_lock(database:Path):
    lock=database.parent/'.training-practice.lock'
    if lock.is_symlink():raise HTTPException(409,'Practice is unavailable. Ask your trainer for help.')
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
    stream=os.fdopen(fd,'r+b')
    if os.fstat(fd).st_size==0:stream.write(b'0');stream.flush()
    start=time.monotonic()
    try:
        while True:
            try:
                if os.name=='nt':
                    import msvcrt
                    stream.seek(0);msvcrt.locking(fd,msvcrt.LK_NBLCK,1)
                else:
                    import fcntl
                    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
                break
            except (BlockingIOError,OSError):
                if time.monotonic()-start>10:raise HTTPException(503,'Another practice is starting. Please try again.')
                time.sleep(.05)
        yield
    finally:
        stream.close()

class ReviewStart(BaseModel):
    model_config=ConfigDict(extra='forbid')
    reference:str=Field(pattern=r'^TRN-DECISION-[A-Z0-9]{8,20}$')
    department_id:int=Field(gt=0)

@router.post('/review-case')
def review_case(payload:ReviewStart,user:models.User=Depends(require_user),db:Session=Depends(get_db)):
    if not is_isolated_training(db):raise HTTPException(404,'Practice is available only in Operations Training.')
    emails=[email for email, in db.query(models.User.email).all()]
    if not emails or any(not email or not email.endswith('@training.invalid') for email in emails):
        raise HTTPException(404,'Practice is available only in the fictional training copy.')
    authorize_action(db,user,'approvals',Action.DECIDE,department_id=payload.department_id)
    colleague=None
    for candidate in db.query(models.User).join(models.UserDepartment).filter(models.UserDepartment.department_id==payload.department_id,models.User.id!=user.id).order_by(models.User.id).all():
        try:authorize_action(db,candidate,'requests',Action.CREATE,department_id=payload.department_id)
        except HTTPException:continue
        colleague=candidate;break
    if colleague is None:raise HTTPException(409,'No practice colleague is available for this department. Ask your trainer for help.')
    approvals=[]
    with practice_lock(Path(db.get_bind().url.database)):
        for label,supported in [('Missing supplier quote',False),('Checked supplier quote',True)]:
            title=f'{label} {payload.reference}'
            matching=db.query(models.Request).filter(models.Request.title==title,models.Request.requested_by_id==colleague.id,models.Request.department_id==payload.department_id).all()
            if len(matching)>1:raise HTTPException(409,'This practice request needs review. Start a fresh practice.')
            request=matching[0] if matching else None
            if request is None:
                reason=('The practice supplier quote has been checked: PHP 1,500 for the replacement fan guard. The amount and work are supported.' if supported else 'A replacement fan guard is needed, but the supplier quote is missing. The price has not been checked.')
                created=create_resource_authorized('requests',{'title':title,'department_id':payload.department_id,'request_type':'Equipment','urgency':'Normal','reason':reason,'note':'Fictional colleague request for training.'},user=colleague,db=db)
                request=db.get(models.Request,created['id'])
            rows=db.query(models.Approval).filter(models.Approval.source_type=='ops_need',models.Approval.source_id==request.id).all()
            if not rows and request.status=='Draft':
                _,approval=submit_request(db,colleague,request.id,'Prepared colleague request for this practice.');db.commit()
            elif len(rows)==1:approval=rows[0]
            else:raise HTTPException(409,'This practice request needs review. Start a fresh practice.')
            authorize_action(db,user,'approvals',Action.VIEW,obj=approval)
            approvals.append(approval.id)
    return {'reference':payload.reference,'record_id':approvals[0],'related_record_id':approvals[1]}
