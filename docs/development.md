# Local Development Guide

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (`npm install -g pnpm`)
- **Python** >= 3.11 (`brew install python@3.11`)
- **Docker** (for PostgreSQL 16)

## Quick Start

```bash
# 1. Run bootstrap script (or execute steps manually)
./scripts/setup.sh

# 2. Start all services (Next.js :3000, NestJS :3001, FastAPI :8001)
pnpm dev
```

## Service Ports

| Service | URL | Notes |
|---|---|---|
| Web Frontend (`apps/web`) | `http://localhost:3000` | Next.js 16 App Router |
| REST API (`apps/api`) | `http://localhost:3001/api/v1` | NestJS |
| Swagger Docs | `http://localhost:3001/api/docs` | OpenAPI 3.0 |
| AI Service (`apps/ai`) | `http://localhost:8001` | FastAPI + Uvicorn |
| PostgreSQL (`docker`) | `localhost:5434` | Mapped to container port 5432 |

## Switching AI Providers (`mock` vs `fashn-api`)

### 1. Local Mock Mode (Default)
In `.env` and `apps/ai/.env`:
```env
AI_PROVIDER=mock
```
Runs offline with zero cost and generates a clearly watermarked composite image (`MOCK MODE - Pipeline Test Only`).

### 2. Real FASHN API Mode
In `.env` and `apps/ai/.env`:
```env
AI_PROVIDER=fashn-api
AI_API_KEY=fa-your-api-key
AI_REQUEST_TIMEOUT_SECONDS=120
FASHN_MODEL_NAME=tryon-v1.6
FASHN_MODE=balanced
FASHN_RETURN_BASE64=true
```
If `AI_PROVIDER=fashn-api` is enabled without `AI_API_KEY`, the AI service and Web UI fail with a clear configuration error explaining that `AI_API_KEY` is required (never silently falling back to mock).

## Running Tests & Evaluation Harness

```bash
# Run all workspace tests (NestJS Jest + Python pytest)
pnpm test

# Run only NestJS API tests
pnpm --filter @wearme/api test

# Run only Python AI service tests
pnpm --filter @wearme/ai test

# Run the 15-case evaluation harness (dry-run with mock or live with fashn-api)
./apps/ai/.venv/bin/python scripts/evaluate_vton.py --provider mock
```
