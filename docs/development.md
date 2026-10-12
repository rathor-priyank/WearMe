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

## Switching AI Providers (`mock` vs `huggingface` vs `fashn-api`)

### 1. Local Mock Mode (Default Fallback)
In `.env` and `apps/ai/.env`:
```env
AI_PROVIDER=mock
```
Runs offline with zero cost and generates a clearly watermarked composite image (`MOCK MODE - Pipeline Test Only`). Used by default when no provider is configured and during automated tests.

> **Important**: When a real provider (`huggingface` or `fashn-api`) is configured, WearMe **never silently falls back to `mock`** after a failed inference. Any runtime error fails the job explicitly with a sanitized diagnostic message so mock output is never presented as genuine AI clothing.

### 2. Free Hugging Face ZeroGPU Mode (`yisol/IDM-VTON`, Non-Commercial)
1. Create a free Hugging Face account and generate a **Read** access token (`hf_...`) at `https://huggingface.co/settings/tokens`.
2. In both `.env` and `apps/ai/.env`, set:
   ```env
   AI_PROVIDER=huggingface
   HF_TOKEN=hf_your_read_only_token
   HF_SPACE_ID=yisol/IDM-VTON
   HF_DENOISE_STEPS=30
   AI_REQUEST_TIMEOUT_SECONDS=180
   ```
3. Restart the FastAPI AI service (`apps/ai` on port `8001`) and verify `GET http://localhost:8001/health` returns `"provider": "huggingface"`.

> **License Notice (`CC BY-NC-SA 4.0`)**: `yisol/IDM-VTON` and its underlying DensePose/HumanParsing dependencies are licensed strictly for **non-commercial research and personal evaluation**. For commercial applications, use a commercially licensed alternative (such as `AI_PROVIDER=fashn-api`, subject to FASHN AI's terms and credit pricing, or a self-hosted model with commercial rights).

### 3. Commercial FASHN API Mode
In `.env` and `apps/ai/.env`:
```env
AI_PROVIDER=fashn-api
AI_API_KEY=fa-your-api-key
AI_REQUEST_TIMEOUT_SECONDS=120
FASHN_MODEL_NAME=tryon-v1.6
FASHN_MODE=balanced
FASHN_RETURN_BASE64=true
```
If `AI_PROVIDER=fashn-api` is enabled without `AI_API_KEY`, the AI service and Web UI fail with a clear configuration error explaining that `AI_API_KEY` is required.

### 4. Experimental Necklace & Pendant Local CV PoC (`landmark_jewellery_neck`)
To enable the experimental local computer-vision pipeline for `NECKLACE` and `PENDANT` subcategories, set `ENABLE_NECKLACE_POC=true` in both `.env` (for `apps/api`) and `apps/ai/.env` (for `apps/ai`):
```env
ENABLE_NECKLACE_POC=true
```
(Or set `AI_PROVIDER=necklace-poc` for standalone necklace PoC evaluation.)
When `ENABLE_NECKLACE_POC=true` is set on **both** `apps/api` and `apps/ai`:
- `GET /api/v1/try-on/categories` verifies that both services have `ENABLE_NECKLACE_POC=true` before reporting `necklacePocEnabled: true` and `providerSupportStatus: "experimental_poc"`. If either service has `ENABLE_NECKLACE_POC=false`, `NECKLACE` and `PENDANT` remain `requires_specialized_model` and uploads are rejected before job creation.
- `NECKLACE` and `PENDANT` requests route to `NecklacePocProvider` (`landmark_jewellery_neck`), which executes 10 stages locally (input validation, MediaPipe or heuristic contour neck/clavicle landmark estimation with plausibility validation, product alpha matting, thin-chain-preserving catenary/perspective warping, chin/hair occlusion masking, soft contact shadow, and feather compositing with 100% pixel identity outside the ROI).
- When MediaPipe is not installed in the Python environment, the fallback contour estimator is explicitly tagged as `detector_backend: "heuristic_skin_silhouette_fallback"` with `verified_anatomical: false`.
- `EARRINGS`, `EYEWEAR`, and other non-clothing categories remain gated with `requires_specialized_model`.

## Web Application Routes (`apps/web`)

| Route | Purpose |
|---|---|
| `/` | Home & Landing Page (4-step pipeline overview, capability tiers, privacy summary, technical FAQ) |
| `/try-on` | Interactive Virtual Try-On Studio (2-column layout, 8-domain / 38-subcategory selector driven by live API capability status, before/after comparison slider, instant job deletion) |
| `/categories` | Category Explorer (full 38-item wearable capability matrix with domain & support status filters) |
| `/history` | Session Results & Job History (syncs and reconciles browser session jobs via `x-wearme-session-id` with `GET /api/v1/try-on/jobs` and supports one-click `DELETE /api/v1/try-on/:jobId`) |
| `/privacy` | Privacy, Session Scoping (`x-wearme-session-id`), Data Retention (`expiresAt` 7-day metadata, `pnpm cleanup:storage`, immediate hard delete) & Provider Licensing Guide |

## Troubleshooting Hugging Face (`AI_PROVIDER=huggingface`)

- **ZeroGPU Quota Reached (`429`)**: Ensure `HF_TOKEN` is set in both `.env` and `apps/ai/.env` and restart the AI service. Free Hugging Face accounts receive ~60 seconds/day of ZeroGPU compute (~2–4 try-ons/day).
- **Space Sleeping or Queue Full (`502` / `429`)**: The public `yisol/IDM-VTON` Space can sleep during inactivity or queue up under heavy load. Wait 30–60 seconds and submit the try-on again.
- **Token & Path Security**: `HF_TOKEN`, `AI_API_KEY`, `Bearer` tokens, and internal server filesystem paths are automatically redacted from all logs, API responses, and persisted job error messages.

## Running Tests, Storage Cleanup & Evaluation Harness

```bash
# Run all workspace tests (NestJS Jest + Python pytest — all mocked, 0 GPU usage)
pnpm test

# Run only NestJS API tests
pnpm --filter @wearme/api test

# Run only Python AI service tests
./apps/ai/.venv/bin/pytest apps/ai/tests/test_ai_service.py -v

# Purge expired database jobs (expiresAt <= now) and orphaned uploads/jobs/<jobId>/ directories
pnpm cleanup:storage

# Run the 20-case pilot evaluation harness (dry-run with Necklace PoC enabled, $0 cost)
./apps/ai/.venv/bin/python scripts/evaluate_vton.py \
  --manifest scripts/eval_manifest.pilot20.example.json \
  --provider necklace-poc \
  --enable-necklace-poc \
  --dry-run
```
