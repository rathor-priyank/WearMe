# AI Pipeline & FASHN v1 Integration

## Provider Architecture

The AI layer in `apps/ai` (Python 3.11 + FastAPI on port `8001`) implements the `VTONProvider` interface (`apps/ai/app/services/base.py`):

- **`MockProvider` (`AI_PROVIDER=mock`)**: Deterministic Pillow image overlay with a clear `"MOCK MODE - Pipeline Test Only (Not Real AI)"` watermark and `is_mock: true` metadata flag.
- **`FASHNApiProvider` (`AI_PROVIDER=fashn-api`)**: Production integration with the official FASHN API v1 (`https://api.fashn.ai/v1`).

## Official FASHN API v1 Workflow (`FASHNApiProvider`)

1. **Input Validation & Encoding (`apps/ai/app/services/image_validator.py`)**:
   - Verifies magic bytes (`JPEG`, `PNG`, `WEBP`), full Pillow image decoding, file size (`<= 10 MB`), dimensions (`64x64` to `4096x4096`), and aspect ratio (`1:16` to `16:1`).
   - Encodes `person_image` and `garment_image` as accurate `data:{mime_type};base64,...` URIs.
2. **Prediction Submission (`POST https://api.fashn.ai/v1/run`)**:
   - Sends `Authorization: Bearer <AI_API_KEY>` and the verified FASHN v1 schema:
     ```json
     {
       "model_name": "tryon-v1.6",
       "inputs": {
         "model_image": "data:image/jpeg;base64,...",
         "garment_image": "data:image/jpeg;base64,...",
         "category": "tops",
         "mode": "balanced",
         "garment_photo_type": "auto",
         "moderation_level": "permissive",
         "output_format": "jpeg",
         "return_base64": true
       }
     }
     ```
   - Also supports `FASHN_MODEL_NAME=tryon-max` (automatically mapping `product_image` and `generation_mode`).
   - Never retries `POST /v1/run` after a prediction ID is issued or on read timeouts/4xx responses, preventing duplicate paid runs.
3. **Status Polling (`GET https://api.fashn.ai/v1/status/{id}`)**:
   - Polls through `starting` $\rightarrow$ `in_queue` $\rightarrow$ `processing` until `completed` or `failed`, bounded by `AI_REQUEST_TIMEOUT_SECONDS` (default `120s`).
   - Retries transient poll network/5xx errors up to 3 times with backoff using the same `prediction_id`.
4. **Output Resolution & SSRF Protection**:
   - Decodes base64 output directly when `FASHN_RETURN_BASE64=true` (default).
   - If a URL is returned, strictly validates `https://` scheme and host against `cdn.fashn.ai` and `media.fashn.ai` before downloading, then verifies image integrity via Pillow.

## Configuration Reference

Set in `.env` and `apps/ai/.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AI_PROVIDER` | `mock` | `mock` or `fashn-api` |
| `AI_API_KEY` | *(empty)* | Required when `AI_PROVIDER=fashn-api` |
| `AI_REQUEST_TIMEOUT_SECONDS` | `120` | End-to-end request + polling timeout in seconds |
| `FASHN_MODEL_NAME` | `tryon-v1.6` | `tryon-v1.6` (stable, 1 credit) or `tryon-max` (1–5 credits) |
| `FASHN_MODE` | `balanced` | `performance` / `balanced` / `quality` |
| `FASHN_RETURN_BASE64` | `true` | Return base64 directly instead of 72h FASHN CDN URL |
| `FASHN_GARMENT_PHOTO_TYPE` | `auto` | `auto` / `flat-lay` / `model` |
| `FASHN_MODERATION_LEVEL` | `permissive` | `conservative` / `permissive` / `none` |

For detailed pricing, data retention, and multi-provider comparison (`FASHN` vs `fal.ai` vs `Replicate`), see [AI Provider Evaluation](ai-provider-evaluation.md).
