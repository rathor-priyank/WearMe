# AI Pipeline & Virtual Try-On Providers

## Provider Architecture

The AI layer in `apps/ai` (Python 3.11 + FastAPI on port `8001`) implements the `VTONProvider` interface (`apps/ai/app/services/base.py`):

- **`MockProvider` (`AI_PROVIDER=mock`, Default)**: Deterministic Pillow image overlay with a clear `"MOCK MODE - Pipeline Test Only (Not Real AI)"` watermark and `is_mock: true` metadata flag. Used as the default fallback for offline development and automated tests.
- **`HuggingFaceProvider` (`AI_PROVIDER=huggingface`)**: Free ZeroGPU virtual try-on integration via the official `yisol/IDM-VTON` Hugging Face Space (`https://yisol-idm-vton.hf.space`, `api_name="/tryon"`), enhanced with local aspect-ratio preservation and upper-body pixel compositing.
- **`FASHNApiProvider` (`AI_PROVIDER=fashn-api`)**: Commercial REST API integration with the official FASHN API v1 (`https://api.fashn.ai/v1`).

### Fallback & No-Silent-Degradation Policy
- `AI_PROVIDER=mock` is the default when no provider is configured.
- When a real provider (`huggingface` or `fashn-api`) is explicitly selected, the AI service **never silently falls back to `MockProvider`** on a runtime error. Failed jobs transition to `FAILED` with a sanitized, user-safe diagnostic message so a mock test overlay is never mistaken for genuine AI output.
- Neither `HuggingFaceProvider` nor `FASHNApiProvider` automatically retries GPU inference jobs on failure, avoiding accidental repeated GPU quota or credit consumption.

---

## Hugging Face IDM-VTON Workflow (`HuggingFaceProvider`)

1. **Input Validation (`apps/ai/app/services/image_validator.py`)**:
   - Verifies magic bytes (`JPEG`, `PNG`, `WEBP`), full Pillow decoding, file size (`<= 10 MB`), dimensions (`64x64` to `4096x4096`), and aspect ratio (`1:16` to `16:1`).
2. **3:4 Aspect-Ratio Padding (`prepare_person_canvas`)**:
   - `yisol/IDM-VTON` internally resizes inputs to `768x1024` (3:4). To prevent vertical/horizontal stretching on arbitrary phone or studio photos, `HuggingFaceProvider` pads the person image onto a centered 3:4 canvas with edge-replicated borders before calling the Space.
3. **Gradio `/tryon` Execution**:
   - Connects via `gradio_client.Client` to `HF_SPACE_ID` (default `yisol/IDM-VTON`) using `HF_TOKEN` loaded solely from environment variables.
   - Calls `client.predict(..., api_name="/tryon")` with the exact 7-parameter positional signature:
     1. `dict`: `{"background": handle_file(person_path), "layers": [], "composite": None}`
     2. `garm_img`: `handle_file(garment_path)`
     3. `garment_des`: Garment description string
     4. `is_checked`: `True` (enables DensePose + HumanParsing auto-masking on the Space)
     5. `is_checked_crop`: `False` (disabled because 3:4 padding is handled locally)
     6. `denoise_steps`: `HF_DENOISE_STEPS` (default `30`, clamped to `[20, 40]`)
     7. `seed`: `42`
   - Validates that the Space returns a 2-tuple of readable image file paths: `(output_image_path, masked_image_path)`.
4. **Upper-Body Compositing & Identity Preservation (`restore_unmasked_regions`)**:
   - Extracts the exact inpainting region where `mask_gray` is near-neutral gray (`R≈128, G≈128, B≈128`).
   - Harmonizes skin tone in unoccluded arm/neck regions within the mask and feathers only the boundary (`GaussianBlur`), keeping 100% of the original person's face, hair, lower body (pants/skirt/legs), and background untouched.
   - Crops out any 3:4 padding and restores the exact original `(width, height)` of the uploaded person photo.
5. **Error Classification & Token Redaction (`sanitize_upstream_message`)**:
   - All upstream exception text is sanitized via regex (`hf_[A-Za-z0-9]{8,}` and `Bearer ...` headers replaced with `[REDACTED_TOKEN]`) **before** logging or raising.
   - Upstream failures are mapped to structured `VTONError` subclasses:
     - **Space unavailable / sleeping (`VTONProviderError`, `category="space_unavailable"`, `retryable=True`)**: HTTP 502/503/504, Space sleeping, building, paused, or runtime error.
     - **Queue full / overloaded (`VTONQuotaError`, `retryable=True`)**: Gradio queue full or HTTP 429 rate-limiting.
     - **ZeroGPU quota exhausted (`VTONQuotaError`, `retryable=False`)**: Daily/monthly Hugging Face ZeroGPU compute limit reached.
     - **Invalid or expired token (`VTONAuthError`, `retryable=False`)**: HTTP 401/403 or invalid `HF_TOKEN`.
     - **Timeout (`VTONTimeoutError`, `retryable=True`)**: Request exceeded `AI_REQUEST_TIMEOUT_SECONDS`.
     - **API schema mismatch (`VTONProviderError`, `category="schema_mismatch"`, `retryable=False`)**: Upstream `/tryon` signature changed or returned malformed output.

---

## Official FASHN API v1 Workflow (`FASHNApiProvider`)

1. **Input Validation & Encoding (`apps/ai/app/services/image_validator.py`)**:
   - Validates both images and encodes `person_image` and `garment_image` as `data:{mime_type};base64,...` URIs.
2. **Prediction Submission (`POST https://api.fashn.ai/v1/run`)**:
   - Sends `Authorization: Bearer <AI_API_KEY>` and the verified FASHN v1 schema (`tryon-v1.6` or `tryon-max`).
   - Never retries `POST /v1/run` after a prediction ID is issued or on read timeouts/4xx responses, preventing duplicate paid runs.
3. **Status Polling (`GET https://api.fashn.ai/v1/status/{id}`)**:
   - Polls through `starting` $\rightarrow$ `in_queue` $\rightarrow$ `processing` until `completed` or `failed`, bounded by `AI_REQUEST_TIMEOUT_SECONDS` (default `120s`).
4. **Output Resolution & SSRF Protection**:
   - Decodes base64 output directly when `FASHN_RETURN_BASE64=true` (default).
   - If a URL is returned, strictly validates `https://` scheme and host against `cdn.fashn.ai` and `media.fashn.ai` before downloading, then verifies image integrity via Pillow.

---

## Configuration Reference

Set in `.env` and `apps/ai/.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AI_PROVIDER` | `mock` | `mock` (default fallback), `huggingface`, or `fashn-api` |
| `AI_REQUEST_TIMEOUT_SECONDS` | `120` | End-to-end inference timeout in seconds (`180` recommended for `huggingface` ZeroGPU queue) |
| `HF_TOKEN` | *(empty)* | Optional read-only Hugging Face token (`hf_...`) for `AI_PROVIDER=huggingface` ZeroGPU quota |
| `HF_SPACE_ID` | `yisol/IDM-VTON` | Hugging Face Space ID for `AI_PROVIDER=huggingface` |
| `HF_DENOISE_STEPS` | `30` | IDM-VTON diffusion steps (`20` to `40`) |
| `AI_API_KEY` | *(empty)* | Required when `AI_PROVIDER=fashn-api` |
| `FASHN_MODEL_NAME` | `tryon-v1.6` | `tryon-v1.6` (stable, 1 credit) or `tryon-max` (1–5 credits) |
| `FASHN_MODE` | `balanced` | `performance` / `balanced` / `quality` |
| `FASHN_RETURN_BASE64` | `true` | Return base64 directly instead of 72h FASHN CDN URL |
| `FASHN_GARMENT_PHOTO_TYPE` | `auto` | `auto` / `flat-lay` / `model` |
| `FASHN_MODERATION_LEVEL` | `permissive` | `conservative` / `permissive` / `none` |

---

## Troubleshooting (`AI_PROVIDER=huggingface`)

- **Space Sleeping / Building / Unavailable (`502 Bad Gateway`)**: Public Hugging Face Spaces occasionally sleep, rebuild, or restart. Wait 30–60 seconds for the Space to wake up and submit a new job.
- **Gradio Queue Full (`429 Too Many Requests`)**: The public `yisol/IDM-VTON` Space has high concurrent traffic. Wait briefly and retry, or increase `AI_REQUEST_TIMEOUT_SECONDS=180`.
- **ZeroGPU Quota Exhausted (`429`)**:
  - Without `HF_TOKEN`, Hugging Face applies a shared anonymous IP quota that is quickly exhausted. Set a free read-only `HF_TOKEN` from `https://huggingface.co/settings/tokens` in `.env` and `apps/ai/.env`.
  - With a free `HF_TOKEN`, Hugging Face grants ~60s/day of ZeroGPU compute (~2–4 try-ons/day). Wait for the daily reset, upgrade to Hugging Face PRO, or switch providers.
- **Invalid or Expired Token (`401 Unauthorized`)**: Verify that `HF_TOKEN` in `.env` and `apps/ai/.env` starts with `hf_`, has `Read` permissions, and has not been revoked.

---

## Licensing & Commercial Use Restrictions

- **`yisol/IDM-VTON` (`AI_PROVIDER=huggingface`) — Non-Commercial Only**:
  - The `yisol/IDM-VTON` model weights, source code, and public Hugging Face Space are licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (`CC BY-NC-SA 4.0`)**, and depend on DensePose and HumanParsing components carrying non-commercial research restrictions.
  - Consequently, `AI_PROVIDER=huggingface` may **only** be used for academic research, local evaluation, or non-commercial personal demos. It must not be used in a commercial or revenue-generating product.
- **Commercial Alternatives**:
  - For commercial deployments, you must use a provider or model whose license permits commercial use—for example, configuring `AI_PROVIDER=fashn-api` (an alternative commercial API subject to FASHN AI's own terms of service and per-generation credit pricing) or self-hosting a virtual try-on model released under a commercial-friendly license (such as Apache-2.0 or MIT).
  - See [AI Provider Evaluation](ai-provider-evaluation.md) for a comparison of commercial API providers (`FASHN`, `fal.ai`, `Replicate`).

