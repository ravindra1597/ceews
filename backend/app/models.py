from pydantic import BaseModel, Field


# ── Shared primitives ─────────────────────────────────────────────────────────

class Vitals(BaseModel):
    heart_rate: int = Field(..., ge=20, le=300, description="Heart rate in bpm")
    systolic_bp: int = Field(..., ge=50, le=250, description="Systolic BP in mmHg")
    spo2: float = Field(..., ge=50.0, le=100.0, description="SpO2 percentage")
    troponin: float = Field(..., ge=0.0, le=1.0, description="Troponin T in ng/mL")


class VitalHistory(BaseModel):
    heart_rate: list[float] = Field(..., min_length=2)
    systolic_bp: list[float] = Field(..., min_length=2)
    spo2: list[float] = Field(..., min_length=2)
    troponin: list[float] = Field(..., min_length=2)


# ── Risk calculation ──────────────────────────────────────────────────────────

class RiskCalculateRequest(BaseModel):
    vitals: Vitals
    history: VitalHistory


class RiskBreakdown(BaseModel):
    hr: int = Field(..., ge=0, le=100, description="HR contribution %")
    bp: int = Field(..., ge=0, le=100, description="BP contribution %")
    trop: int = Field(..., ge=0, le=100, description="Troponin contribution %")


class RiskCalculateResponse(BaseModel):
    score: int = Field(..., ge=0, le=99)
    level: str
    breakdown: RiskBreakdown
    alerts: list[str]


# ── AI assessment ─────────────────────────────────────────────────────────────

class AIAssessRequest(BaseModel):
    patient_id: str = Field(..., min_length=1, max_length=50)
    fs_collection: str = Field(..., min_length=1, max_length=100)
    vitals: Vitals
    risk_score: int = Field(..., ge=0, le=99)
    risk_level: str = Field(..., pattern="^(Low|Moderate|Critical)$")


class AIAssessResponse(BaseModel):
    assessment: str
    recommendations: list[str]
    timestamp: str
    incident_id: str


# ── Doctor note ───────────────────────────────────────────────────────────────

class DoctorNoteRequest(BaseModel):
    fs_collection: str = Field(..., min_length=1, max_length=100)
    incident_id: str = Field(..., min_length=1, max_length=100)
    note: str = Field(..., min_length=1, max_length=2000)


# ── Auth ──────────────────────────────────────────────────────────────────────

class AuthUser(BaseModel):
    user_id: str
    email: str | None = None
