"""
Risk scoring engine — ported from App.jsx: computeRisk() + computeTrendAlerts().

Weights and thresholds deliberately match the frontend so scores are identical
for the same input. Any change here must be mirrored in utils.js.
"""

from app.models import RiskBreakdown, RiskCalculateResponse, Vitals, VitalHistory

_HISTORY_WINDOW = 10   # readings used for trend detection
_NORMAL_HR = 75        # bpm baseline
_NORMAL_BP = 120       # mmHg baseline
_TROP_SCALE = 0.1      # ng/mL normalisation denominator
_SCORE_DENOM = 300     # denominator that maps total weight → 0–99


def _check_trend(values: list[float], direction: str) -> bool:
    """
    Returns True only when the last _HISTORY_WINDOW readings are strictly
    monotonic in `direction` ("rising" | "falling") and are not a flat line.
    """
    if len(values) < _HISTORY_WINDOW:
        return False
    recent = values[-_HISTORY_WINDOW:]
    for i in range(1, len(recent)):
        if direction == "rising" and recent[i] <= recent[i - 1]:
            return False
        if direction == "falling" and recent[i] >= recent[i - 1]:
            return False
    return recent[0] != recent[-1]


def compute_risk(vitals: Vitals, history: VitalHistory) -> dict:
    """Returns score (0-99), level, and per-component breakdown percentages."""
    hr_trend = vitals.heart_rate  - history.heart_rate[-1]
    bp_trend = vitals.systolic_bp - history.systolic_bp[-1]

    hr_weight   = abs(vitals.heart_rate  - _NORMAL_HR) * 1.2
    bp_weight   = abs(_NORMAL_BP - vitals.systolic_bp) * 1.5
    trop_weight = (vitals.troponin / _TROP_SCALE) * 100

    if hr_trend > 5:
        hr_weight *= 1.5
    if bp_trend < -5:
        bp_weight *= 1.8

    total = hr_weight + bp_weight + trop_weight or 1
    score = min(round((total / _SCORE_DENOM) * 100), 99)
    level = "Low" if score < 30 else ("Moderate" if score < 70 else "Critical")

    return {
        "score": score,
        "level": level,
        "breakdown": RiskBreakdown(
            hr=round((hr_weight   / total) * 100),
            bp=round((bp_weight   / total) * 100),
            trop=round((trop_weight / total) * 100),
        ),
    }


def compute_trend_alerts(history: VitalHistory, vitals: Vitals) -> list[str]:
    """Returns list of human-readable trend alert strings."""
    alerts: list[str] = []

    if _check_trend(history.heart_rate, "rising") and vitals.heart_rate > 100:
        alerts.append("↑ HR Sustained Rise")

    if _check_trend(history.systolic_bp, "rising") and vitals.systolic_bp > 140:
        alerts.append("↑ BP Sustained Rise")
    elif _check_trend(history.systolic_bp, "falling") and vitals.systolic_bp < 90:
        alerts.append("↓ BP Sustained Drop")

    if _check_trend(history.spo2, "falling") and vitals.spo2 < 94:
        alerts.append("↓ SpO2 Sustained Drop")

    if _check_trend(history.troponin, "rising"):
        alerts.append("↑ Troponin Sustained Rise")

    return alerts


def calculate(vitals: Vitals, history: VitalHistory) -> RiskCalculateResponse:
    risk = compute_risk(vitals, history)
    alerts = compute_trend_alerts(history, vitals)
    return RiskCalculateResponse(
        score=risk["score"],
        level=risk["level"],
        breakdown=risk["breakdown"],
        alerts=alerts,
    )
