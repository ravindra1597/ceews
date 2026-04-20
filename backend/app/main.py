import logging
import os
from contextlib import asynccontextmanager

import firebase_admin
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import configure_logging, get_settings
from app.routers import ai, risk

# ── Logging ───────────────────────────────────────────────────────────────────
settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)


# ── Firebase Admin init ───────────────────────────────────────────────────────
def _init_firebase() -> None:
    if firebase_admin._apps:
        return
    sa_path = settings.firebase_service_account_path
    if os.path.exists(sa_path):
        cred = firebase_admin.credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin initialized from service account file")
    else:
        firebase_admin.initialize_app()
        logger.info("Firebase Admin initialized from application default credentials")


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_firebase()
    logger.info("CEEWS backend starting — environment=%s", settings.environment)
    yield
    logger.info("CEEWS backend shutting down")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="CEEWS API",
    description="Cardiac Event Early Warning System — backend API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── Global error handler ──────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled exception on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"], summary="Service health check")
async def health_check() -> dict:
    return {
        "status": "ok",
        "environment": settings.environment,
        "version": app.version,
    }


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(risk.router)
app.include_router(ai.router)
