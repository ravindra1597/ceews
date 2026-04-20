# CEEWS Backend — FastAPI

REST API for the Cardiac Event Early Warning System. Handles risk calculation,
Gemini AI advisory generation, and Firestore persistence with Firebase Auth protection.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Service health check |
| POST | `/api/risk/calculate` | ✓ | Compute risk score + trend alerts |
| POST | `/api/ai/assess` | ✓ | Generate Gemini clinical assessment |
| POST | `/api/ai/note` | ✓ | Save physician clinical note |

Interactive docs at **http://localhost:8000/docs** (Swagger UI).

## Setup

### 1. Python environment

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Firebase service account

1. Firebase Console → Project Settings → Service accounts
2. Click **Generate new private key** → save as `backend/serviceAccountKey.json`
3. **Never commit this file** (it is in `.gitignore`)

### 3. Environment variables

```bash
cp .env.example .env
# Edit .env and fill in GEMINI_API_KEY and FIREBASE_PROJECT_ID
```

### 4. Run locally

```bash
uvicorn app.main:app --reload --port 8000
```

## Docker

```bash
# Build
docker build -t ceews-backend .

# Run (mount the service account key at runtime)
docker run -p 8000:8000 \
  --env-file .env \
  -v $(pwd)/serviceAccountKey.json:/home/appuser/app/serviceAccountKey.json:ro \
  ceews-backend
```

## Authentication

All `/api/*` endpoints require a Firebase ID token:

```
Authorization: Bearer <firebase_id_token>
```

The frontend obtains this via `firebase/auth` → `getIdToken()`.

## Rate limiting

100 requests/minute per IP by default. Configurable via `RATE_LIMIT_PER_MINUTE` in `.env`.

## Project structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app, CORS, lifespan
│   ├── config.py            # Pydantic settings (reads .env)
│   ├── auth.py              # Firebase token verification dependency
│   ├── models.py            # Pydantic request/response schemas
│   ├── routers/
│   │   ├── risk.py          # POST /api/risk/calculate
│   │   └── ai.py            # POST /api/ai/assess, /api/ai/note
│   └── services/
│       ├── risk_engine.py   # Risk score + trend alert logic
│       ├── gemini_service.py# Gemini API wrapper with retry
│       └── firestore_service.py  # Firestore CRUD + audit log
├── Dockerfile
├── requirements.txt
└── .env.example
```
