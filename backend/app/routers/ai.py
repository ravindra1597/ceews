import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.auth import require_auth
from app.config import get_settings
from app.models import (
    AIAssessRequest,
    AIAssessResponse,
    AuthUser,
    DoctorNoteRequest,
)
from app.services import firestore_service, gemini_service

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/api/ai", tags=["AI Advisory"])


@router.post(
    "/assess",
    response_model=AIAssessResponse,
    summary="Generate AI clinical assessment via Gemini",
)
@limiter.limit(f"{get_settings().rate_limit_per_minute}/minute")
async def assess_patient(
    request: Request,
    body: AIAssessRequest,
    user: Annotated[AuthUser, Depends(require_auth)],
) -> AIAssessResponse:
    """
    Calls Gemini 2.5 Flash with the patient's current vitals and risk level.
    Parses the structured ASSESSMENT / RECOMMENDATIONS response and writes it
    to Firestore before returning.

    Retries up to 3× with exponential back-off on transient Gemini errors.
    """
    logger.info(
        "ai/assess: user=%s patient=%s risk=%s score=%d",
        user.user_id, body.patient_id, body.risk_level, body.risk_score,
    )

    try:
        assessment_text, recommendations = await gemini_service.generate_assessment(
            vitals=body.vitals,
            risk_score=body.risk_score,
            risk_level=body.risk_level,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    timestamp = datetime.now(tz=timezone.utc).isoformat()

    try:
        incident_id = firestore_service.save_assessment(
            fs_collection=body.fs_collection,
            patient_id=body.patient_id,
            assessment_text=assessment_text,
            recommendations=recommendations,
            risk_score=body.risk_score,
            vitals=body.vitals,
            user_id=user.user_id,
        )
    except Exception as exc:
        logger.error("Firestore write failed after successful Gemini call: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Assessment generated but could not be saved — please retry",
        ) from exc

    logger.info(
        "ai/assess: complete patient=%s incident=%s",
        body.patient_id, incident_id,
    )
    return AIAssessResponse(
        assessment=assessment_text,
        recommendations=recommendations,
        timestamp=timestamp,
        incident_id=incident_id,
    )


@router.post(
    "/note",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Save physician clinical note to an existing incident",
)
@limiter.limit(f"{get_settings().rate_limit_per_minute}/minute")
async def save_note(
    request: Request,
    body: DoctorNoteRequest,
    user: Annotated[AuthUser, Depends(require_auth)],
) -> None:
    logger.info(
        "ai/note: user=%s collection=%s incident=%s",
        user.user_id, body.fs_collection, body.incident_id,
    )
    try:
        firestore_service.save_doctor_note(
            fs_collection=body.fs_collection,
            incident_id=body.incident_id,
            note_text=body.note,
            user_id=user.user_id,
        )
    except Exception as exc:
        logger.error("Note save failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save clinical note",
        ) from exc
