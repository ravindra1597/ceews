"""
Gemini AI service — ported from App.jsx: callGeminiAdvisor() + parseGeminiResponse().

Runs synchronous SDK calls in a thread pool to avoid blocking the event loop.
Retries up to 3 times with exponential back-off on transient errors.
"""

import asyncio
import logging
import re
from functools import lru_cache

import google.generativeai as genai
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings
from app.models import Vitals

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_model() -> genai.GenerativeModel:
    settings = get_settings()
    genai.configure(api_key=settings.gemini_api_key)
    return genai.GenerativeModel(settings.gemini_model)


def _build_prompt(vitals: Vitals, risk_score: int, risk_level: str) -> str:
    return f"""You are an emergency medicine AI advisor. Analyze this patient's telemetry data and provide a structured clinical assessment.

Patient vitals:
- Heart Rate: {vitals.heart_rate} bpm
- Systolic BP: {vitals.systolic_bp} mmHg
- SpO2: {vitals.spo2}%
- Troponin T: {vitals.troponin} ng/mL
- Risk Score: {risk_score}/99 ({risk_level})

Respond in this exact format (no asterisks, no markdown):

ASSESSMENT: [2-3 sentences of urgent clinical assessment using precise medical terminology. Assess risk of myocardial infarction or hemodynamic compromise.]

RECOMMENDATIONS:
1. [First immediate clinical action]
2. [Second clinical action]
3. [Third clinical action]
4. [Fourth clinical action]
5. [Fifth clinical action]"""


def _parse_response(text: str) -> tuple[str, list[str]]:
    assessment_match = re.search(
        r"ASSESSMENT:\s*([\s\S]*?)(?:\n\s*RECOMMENDATIONS:|$)", text, re.IGNORECASE
    )
    recs_match = re.search(r"RECOMMENDATIONS:\s*([\s\S]*)", text, re.IGNORECASE)

    assessment = assessment_match.group(1).strip() if assessment_match else text.strip()

    recommendations: list[str] = []
    if recs_match:
        recommendations = [
            re.sub(r"^\d+[.)]\s+", "", line.strip())
            for line in recs_match.group(1).splitlines()
            if re.match(r"^\d+[.)]\s+", line.strip())
        ]

    return assessment, recommendations


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type(Exception),
    reraise=True,
)
def _generate_sync(prompt: str) -> str:
    model = _get_model()
    response = model.generate_content(prompt)
    return response.text


async def generate_assessment(
    vitals: Vitals, risk_score: int, risk_level: str
) -> tuple[str, list[str]]:
    """
    Returns (assessment_text, recommendations_list).
    Raises RuntimeError if Gemini fails after all retries.
    """
    prompt = _build_prompt(vitals, risk_score, risk_level)
    logger.info("Calling Gemini for risk_level=%s score=%d", risk_level, risk_score)

    try:
        raw_text: str = await asyncio.to_thread(_generate_sync, prompt)
    except RetryError as exc:
        logger.error("Gemini failed after retries: %s", exc)
        raise RuntimeError("AI service temporarily unavailable — please retry") from exc
    except Exception as exc:
        logger.error("Gemini unexpected error: %s", exc, exc_info=True)
        raise RuntimeError("AI service error") from exc

    assessment, recommendations = _parse_response(raw_text)
    logger.info(
        "Gemini response parsed: assessment=%d chars, recommendations=%d",
        len(assessment),
        len(recommendations),
    )
    return assessment, recommendations
