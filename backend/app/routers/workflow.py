from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services.approval_workflow import decide_approval
from ..services.external_review_workflow import create_approval, create_task, mark_seen, reject_item
from ..services.fix_workflow import finish_fix, reopen_fix, start_fix, verify_fix
from ..services.guest_workflow import create_fix_from_guest
from ..services.request_workflow import complete_request, plan_request, submit_request
from ..services.submission_workflow import decide_submission
from ..services.operational_workflow import allowed_actions_for, transition_operational
from ..utils import model_to_dict
from .api import require_user

router = APIRouter(prefix="/api", tags=["workflow"])


class WorkflowCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = None
    department_id: int | None = None
    proof_url: str | None = None
    filename: str | None = None


class SubmissionDecisionCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["Accepted", "Rejected"]
    note: str | None = None


def _operational_result(db: Session, user: models.User, resource: str, item_id: int, action: str, note: str | None):
    obj = transition_operational(db, user, resource, item_id, action, note)
    result = model_to_dict(obj)
    result["allowed_actions"] = allowed_actions_for(db, user, resource, obj)
    return result


@router.post("/workflow/tasks/{item_id}/{action}")
def task_transition(item_id: int, action: Literal["start", "submit-review", "request-changes", "complete", "reopen"], payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return _operational_result(db, user, "tasks", item_id, action, payload.note)


@router.post("/workflow/projects/{item_id}/{action}")
def project_transition(item_id: int, action: Literal["start", "pause", "resume", "complete", "reopen"], payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return _operational_result(db, user, "projects", item_id, action, payload.note)


@router.post("/workflow/posts/{item_id}/{action}")
def post_transition(item_id: int, action: Literal["start-draft", "submit-review", "resubmit-review", "request-revision", "approve", "schedule", "publish", "return-draft-from-fix", "return-draft-from-ok", "return-draft-from-set", "reopen"], payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return _operational_result(db, user, "posts", item_id, action, payload.note)


@router.post("/workflow/guests/{item_id}/create-fix")
def guest_create_fix(item_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    guest, fix = create_fix_from_guest(db, user, item_id, payload.department_id, payload.note)
    return {"guest": model_to_dict(guest), "fix": model_to_dict(fix)}


@router.post("/workflow/guests/{item_id}/{action}")
def guest_transition(item_id: int, action: Literal["follow-up", "resolve-open", "resolve-follow", "reopen"], payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return _operational_result(db, user, "guests", item_id, action, payload.note)


@router.post("/workflow/shift-notes/{item_id}/{action}")
def shift_transition(item_id: int, action: Literal["acknowledge", "follow-up-new", "follow-up-seen", "resolve-new", "resolve-seen", "resolve-follow", "reopen"], payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return _operational_result(db, user, "shift-notes", item_id, action, payload.note)


@router.post("/workflow/requests/{request_id}/submit-approval")
def request_submit(request_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    request, approval = submit_request(db, user, request_id, payload.note)
    return {"request": model_to_dict(request), "approval": model_to_dict(approval)}


@router.post("/workflow/requests/{request_id}/plan")
def request_plan(request_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    request, task = plan_request(db, user, request_id, payload.note)
    return {"request": model_to_dict(request), "task": model_to_dict(task)}


@router.post("/workflow/requests/{request_id}/complete")
def request_complete(request_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(complete_request(db, user, request_id, payload.note))


@router.post("/workflow/approvals/{approval_id}/decide")
def approval_decide(approval_id: int, payload: WorkflowCommand, status: str = Query(...), user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    approval, request, external_item = decide_approval(db, user, approval_id, status, payload.note)
    return {
        "approval": model_to_dict(approval),
        "request": model_to_dict(request) if request else None,
        "external_review_item": model_to_dict(external_item) if external_item else None,
        "task": None,
    }


@router.post("/workflow/submissions/{submission_id}/decide")
def submission_decide(submission_id: int, payload: SubmissionDecisionCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(decide_submission(db, user, submission_id, payload.status, payload.note))


@router.post("/workflow/fixes/{fix_id}/start")
def fix_start(fix_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(start_fix(db, user, fix_id, payload.note))


@router.post("/workflow/fixes/{fix_id}/done")
def fix_done(fix_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(finish_fix(db, user, fix_id, payload.note))


@router.post("/workflow/fixes/{fix_id}/verify")
def fix_verify(fix_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(verify_fix(db, user, fix_id, payload.note, payload.proof_url, payload.filename))


@router.post("/workflow/fixes/{fix_id}/reopen")
def fix_reopen(fix_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(reopen_fix(db, user, fix_id, payload.note))


@router.post("/integrations/review-items/{item_id}/create-task")
def external_create_task(item_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    task, item = create_task(db, user, item_id, payload.department_id, payload.note)
    return {"task": model_to_dict(task), "review_item": model_to_dict(item)}


@router.post("/integrations/review-items/{item_id}/create-approval")
def external_create_approval(item_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    approval, item = create_approval(db, user, item_id, payload.department_id, payload.note)
    return {"approval": model_to_dict(approval), "review_item": model_to_dict(item)}


@router.post("/integrations/review-items/{item_id}/mark-seen")
def external_mark_seen(item_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(mark_seen(db, user, item_id, payload.note))


@router.post("/integrations/review-items/{item_id}/reject")
def external_reject(item_id: int, payload: WorkflowCommand, user: models.User = Depends(require_user), db: Session = Depends(get_db)):
    return model_to_dict(reject_item(db, user, item_id, payload.note))
