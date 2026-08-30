from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from .. import models
from ..capabilities import has_capability
from ..database import engine
from ..observability import metrics
from .api import require_user
from fastapi import HTTPException


router = APIRouter(prefix="/api", tags=["observability"])


@router.get("/metrics", response_class=PlainTextResponse)
def operational_metrics(user: models.User = Depends(require_user)):
    if not has_capability(user.role, "view_system_health"):
        raise HTTPException(status_code=403, detail="System health access required")
    pool_status = str(engine.pool.status()).replace("\n", " ")
    return PlainTextResponse(metrics.prometheus(), headers={"X-Database-Pool-Status": pool_status[:240], "Cache-Control": "no-store"})
