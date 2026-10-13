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

### Public Business & Trust Routes (No Login Required)
| Route | Purpose |
|---|---|
| `/` | Enterprise Business Homepage (Hero, What WearMe Does, 7-step Local Shop + 7-step Online Shopper flows, Audience cards, Security & Privacy section, 12-question FAQ, Contact & Support) |
| `/about` | About WearMe, Dual-Ecosystem Mission & Engineering Commitments |
| `/how-it-works` | Detailed 7-step Walk-In Boutique QR flow & 7-step Online Shopper Digital Wardrobe flow |
| `/partner` | B2B2C Boutique Partner Network, Tiers & Strict Shopkeeper Privacy Boundary Matrix |
| `/categories` | Category Explorer (full 56-subcategory wearable capability matrix across 8 domains) |
| `/security` | Security & Privacy Architecture (Customer/Shopkeeper isolation, HMAC-signed files, OTP security, upload validation) |
| `/privacy` | Data Retention (`expiresAt`), Portrait Deletion, Account Erasure & Provider Licensing Guide |
| `/terms` | Terms of Use & Visual Style Preview Disclaimers |
| `/faq` | 12-Question FAQ covering privacy, shopkeeper boundaries, and AI capabilities |
| `/help` | Help Center & Portrait Upload Guides |
| `/contact` | Interactive Contact & Support Desk (`POST /api/v1/wardrobe/contact`) |
| `/login` | Multi-Channel Passwordless OTP Sign-In (`whatsapp`, `sms`, `email`) |
| `/try-on?storeId=<validStoreId>` | Zero-friction Walk-In Boutique QR Try-On Exception (server-verified store attribution) |

### Protected Customer Application Routes (Requires Authentication)
| Route | Purpose |
|---|---|
| `/try-on` | Standalone Online Virtual Try-On Studio (requires customer authentication when accessed without a valid boutique QR `storeId`) |
| `/my-wardrobe` | Personal Digital Wardrobe (saved base portrait, 1-click cross-retailer try-on catalog, saved looks, 1-click portrait deletion) |
| `/history` | Customer Session & Job History (inspect and permanently delete try-on jobs and files) |
| `/account` | Customer Account & Privacy Controls (`DELETE /api/v1/wardrobe/portrait`, `DELETE /api/v1/wardrobe/account`, `POST /api/v1/auth/logout`) |

## Security, Multi-Channel OTP & Customer/Shopkeeper Isolation (`apps/api`)

```env
# HMAC secret for signing customer auth tokens, HttpOnly cookies, and signed file URLs
AUTH_TOKEN_SECRET=replace-with-32-byte-secret-in-production

# Optional live webhook endpoints for OTP delivery (when omitted in non-production, local sandbox preview is used)
WHATSAPP_OTP_WEBHOOK_URL=
SMS_OTP_WEBHOOK_URL=
EMAIL_OTP_WEBHOOK_URL=
```

- **Strict Shopkeeper Boundary**: `GET /api/v1/files/jobs/:jobId/:filename` and `GET /api/v1/files/users/:userId/:filename` enforce server-side ownership checks and immediately reject any request carrying shopkeeper headers (`x-wearme-partner-store-id`, `x-wearme-partner-key`) or `?storeId=` with `403 Forbidden`. Partner boutiques can only query aggregated counts via `GET /api/v1/wardrobe/stores/:storeId/analytics`, `GET /api/v1/wardrobe/stores/:storeId/subscription`, and `GET /api/v1/wardrobe/stores/:storeId/usage`.
- **Multi-Channel OTP (`whatsapp`, `sms`, `email`)**: `POST /api/v1/wardrobe/otp/request` and `POST /api/v1/wardrobe/session/upgrade` support WhatsApp, SMS, and Email OTP verification with 5-minute TTL, 30-second resend cooldown, attempt lockouts, constant-time comparison, and single-use invalidation. In `NODE_ENV=production`, the `123456` dev fallback is strictly disabled.

## Store-Sponsored QR Sessions, Subscription Quotas & Consumer Billing (`apps/api`)

```env
STORE_SESSION_MAX_LIFETIME_MINUTES=60
STORE_SESSION_INACTIVITY_MINUTES=15
PERSONAL_AUTHENTICATED_CREDITS=10
PERSONAL_ANONYMOUS_CREDITS=5
USAGE_RESERVATION_TTL_MINUTES=15
```

- **Server-Verified Billing Mode (`STORE_SPONSORED` vs `PERSONAL`)**: Every `TryOnJob` records an authoritative `billingMode` (`STORE_SPONSORED`, `PERSONAL`, or `LEGACY_UNKNOWN`). The backend never infers billing responsibility from `User.originStoreId`, a query parameter (`?storeId=`), or browser storage alone.
- **Bounded Store-Sponsored QR Sessions**: Scanning `/try-on?storeId=<storeId>` invokes `POST /api/v1/wardrobe/stores/:storeId/sessions`, which creates or inspects a server-side `TryOnSession` with `sponsoredExpiresAt` (`STORE_SESSION_MAX_LIFETIME_MINUTES`, default 60 min) and `inactivityTimeoutMinutes` (default 15 min). Refreshing the page (`forceRefreshScan: false`) never extends `sponsoredExpiresAt`.
- **Switching to Personal WearMe**: Customers can switch their session to Personal WearMe (`POST /api/v1/entitlements/session/switch-personal`) or inspect their current billing mode and personal/sponsored credits (`GET /api/v1/entitlements/status`) at any time.
- **Cross-Instance Pre-Inference Atomic Quota Reservation**: Before downloading images or invoking AI inference, `TryOnService.processJob` performs a row-locked conditional PostgreSQL `UPDATE` on `PartnerStoreSubscription` (`STORE_SPONSORED`) or `ConsumerEntitlement` (`PERSONAL`), creates a unique `UsageReservation` (`PENDING`), and appends a `UsageLedgerEntry` (`RESERVATION`). On completion, the reservation transitions idempotently (`PENDING -> CONSUMED`). On failure, the reservation transitions idempotently (`PENDING -> RELEASED`), refunding `reservedCredits` and incrementing `failedGenerationsCount` at most once.

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
