"""
Firestore service — Firebase Admin SDK wrapper.

All writes include an audit log entry recording user_id, operation, and timestamp.
"""

import logging
from datetime import datetime, timezone

from firebase_admin import firestore
from google.cloud.firestore_v1 import SERVER_TIMESTAMP

from app.models import Vitals

logger = logging.getLogger(__name__)


def _db():
    return firestore.client()


# ── Audit logging ─────────────────────────────────────────────────────────────

def _write_audit_log(
    user_id: str,
    operation: str,
    collection: str,
    document_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    try:
        _db().collection("audit_log").add({
            "user_id": user_id,
            "operation": operation,
            "collection": collection,
            "document_id": document_id,
            "metadata": metadata or {},
            "timestamp": SERVER_TIMESTAMP,
        })
    except Exception as exc:
        logger.error("Audit log write failed: %s", exc, exc_info=True)


# ── Incident / assessment CRUD ────────────────────────────────────────────────

def save_assessment(
    fs_collection: str,
    patient_id: str,
    assessment_text: str,
    recommendations: list[str],
    risk_score: int,
    vitals: Vitals,
    user_id: str,
) -> str:
    """
    Writes a new assessment document to Firestore.
    Returns the new document ID.
    """
    doc_data = {
        "text": assessment_text,
        "score": risk_score,
        "recommendations": recommendations,
        "vitals": {
            "heartRate":  vitals.heart_rate,
            "systolicBP": vitals.systolic_bp,
            "spo2":       vitals.spo2,
            "troponin":   vitals.troponin,
        },
        "timestamp":  datetime.now(tz=timezone.utc).isoformat(),
        "created_by": user_id,
        "server_ts":  SERVER_TIMESTAMP,
    }

    try:
        _, doc_ref = _db().collection(fs_collection).add(doc_data)
        doc_id = doc_ref.id
        logger.info(
            "Assessment saved: collection=%s doc=%s user=%s",
            fs_collection, doc_id, user_id,
        )
        _write_audit_log(
            user_id=user_id,
            operation="save_assessment",
            collection=fs_collection,
            document_id=doc_id,
            metadata={"patient_id": patient_id, "risk_score": risk_score},
        )
        return doc_id
    except Exception as exc:
        logger.error("Firestore save_assessment failed: %s", exc, exc_info=True)
        raise


def save_doctor_note(
    fs_collection: str,
    incident_id: str,
    note_text: str,
    user_id: str,
) -> None:
    """
    Updates an existing assessment document with a physician's clinical note.
    """
    try:
        doc_ref = _db().collection(fs_collection).document(incident_id)
        doc_ref.update({
            "doctorNote":      note_text.strip(),
            "noteTimestamp":   SERVER_TIMESTAMP,
            "note_updated_by": user_id,
        })
        logger.info(
            "Doctor note saved: collection=%s doc=%s user=%s",
            fs_collection, incident_id, user_id,
        )
        _write_audit_log(
            user_id=user_id,
            operation="save_doctor_note",
            collection=fs_collection,
            document_id=incident_id,
        )
    except Exception as exc:
        logger.error("Firestore save_doctor_note failed: %s", exc, exc_info=True)
        raise


def get_incidents(fs_collection: str, limit: int = 10) -> list[dict]:
    """Returns the most recent `limit` incidents, newest first."""
    try:
        docs = (
            _db()
            .collection(fs_collection)
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        return [{"id": d.id, **d.to_dict()} for d in docs]
    except Exception as exc:
        logger.error("Firestore get_incidents failed: %s", exc, exc_info=True)
        raise
