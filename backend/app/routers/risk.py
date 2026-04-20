import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth import require_auth
from app.config import get_settings
from app.models import AuthUser, RiskCalculateRequest, RiskCalculateResponse
from app.services import risk_engine

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/api/risk", tags=["Risk"])


@router.post(
    "/calculate",
    response_model=RiskCalculateResponse,
    summary="Calculate patient risk score",
)
@limiter.limit(f"{get_settings().rate_limit_per_minute}/minute")
async def calculate_risk(
    request: Request,
    body: RiskCalculateRequest,
    user: Annotated[AuthUser, Depends(require_auth)],
) -> RiskCalculateResponse:
    """
    Accepts current vitals and sliding-window history.
    Returns a 0–99 risk score, Low/Moderate/Critical level,
    per-component XAI breakdown, and active trend alerts.
    """
    logger.info(
        "risk/calculate: user=%s HR=%d BP=%d SpO2=%.1f Trop=%.3f",
        user.user_id,
        body.vitals.heart_rate,
        body.vitals.systolic_bp,
        body.vitals.spo2,
        body.vitals.troponin,
    )
    result = risk_engine.calculate(body.vitals, body.history)
    logger.info(
        "risk/calculate: score=%d level=%s alerts=%s",
        result.score, result.level, result.alerts,
    )
    return result
