import asyncio
import base64
import io
import logging
import time
from urllib.parse import urlparse
import httpx
from PIL import Image, UnidentifiedImageError

from .base import (
    VTONAuthError,
    VTONConfigError,
    VTONError,
    VTONProvider,
    VTONProviderError,
    VTONQuotaError,
    VTONTimeoutError,
    VTONValidationError,
)
from .image_validator import ImageValidationError, validate_and_encode_image

logger = logging.getLogger("wearme.ai.fashn")

SUPPORTED_UPPER_CATEGORIES = {"TOP", "SHIRT", "TSHIRT", "JACKET", "SWEATER", "HOODIE"}
SUPPORTED_BOTTOM_CATEGORIES = {"TROUSERS", "PANTS", "JEANS", "SKIRT", "SHORTS"}
SUPPORTED_ONEPIECE_CATEGORIES = {"DRESS", "KURTI", "SALWAR_SUIT", "ETHNIC_WEAR"}
SUPPORTED_MODELS = {"tryon-v1.6", "tryon-max"}
ALLOWED_OUTPUT_HOSTS = {"cdn.fashn.ai", "media.fashn.ai"}
MAX_OUTPUT_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB


class FASHNApiProvider(VTONProvider):
    """
    Production Virtual Try-On provider calling the official FASHN API v1
    (https://api.fashn.ai/v1).

    Verified against official FASHN documentation:
    - Universal endpoints:
      - POST https://api.fashn.ai/v1/run
      - GET  https://api.fashn.ai/v1/status/{id}
      - GET  https://api.fashn.ai/v1/credits
    - Request payload requires top-level `model_name` ('tryon-v1.6' or 'tryon-max')
      and nested `inputs` object.
    - Asynchronous prediction workflow: `/v1/run` returns `{"id": "..."}` immediately;
      `/v1/status/{id}` transitions through `starting` -> `in_queue` -> `processing`
      -> `completed` | `failed`.
    """

    BASE_URL = "https://api.fashn.ai/v1"

    def __init__(
        self,
        api_key: str,
        timeout_seconds: float = 120.0,
        timeout_ms: int | None = None,
        model_name: str = "tryon-v1.6",
        mode: str = "balanced",
        return_base64: bool = True,
        garment_photo_type: str = "auto",
        moderation_level: str = "permissive",
        poll_interval_sec: float = 2.0,
        validate_on_init: bool = False,
        allow_extended_clothing: bool = False,
    ) -> None:
        self._api_key = (api_key or "").strip()
        if timeout_ms is not None and timeout_seconds == 120.0:
            self._timeout_sec = max(10.0, float(timeout_ms) / 1000.0)
        else:
            self._timeout_sec = max(10.0, float(timeout_seconds))

        if model_name not in SUPPORTED_MODELS:
            raise VTONConfigError(
                f"Unsupported FASHN_MODEL_NAME '{model_name}'. "
                f"Supported models: {', '.join(sorted(SUPPORTED_MODELS))}."
            )
        self._model_name = model_name
        self._mode = mode.strip().lower()
        self._return_base64 = bool(return_base64)
        self._garment_photo_type = garment_photo_type.strip().lower()
        self._moderation_level = moderation_level.strip().lower()
        self._poll_interval_sec = max(0.05, float(poll_interval_sec))
        self._allow_extended_clothing = allow_extended_clothing

        if validate_on_init:
            self.validate_config()
        elif not self._api_key:
            logger.warning(
                "FASHNApiProvider initialized without AI_API_KEY. "
                "Requests will fail with VTONConfigError until AI_API_KEY is configured."
            )

    @property
    def name(self) -> str:
        return "fashn-api"

    def validate_config(self) -> None:
        """Validate required credentials and parameters before executing inference."""
        if not self._api_key:
            raise VTONConfigError(
                "Configuration error: AI_API_KEY is required when AI_PROVIDER=fashn-api. "
                "Please set a valid FASHN API key in your .env file."
            )

    def _map_category(self, category: str) -> str:
        """
        Map WearMe garment categories to FASHN's 'tops', 'bottoms', or 'one-pieces'.
        Raises VTONValidationError for unsupported categories.
        """
        norm = (category or "").strip().upper()
        if norm in SUPPORTED_UPPER_CATEGORIES:
            return "tops"
        if self._allow_extended_clothing:
            if norm in SUPPORTED_BOTTOM_CATEGORIES:
                return "bottoms"
            if norm in SUPPORTED_ONEPIECE_CATEGORIES:
                return "one-pieces"
        raise VTONValidationError(
            f"Unsupported garment category '{category}'. "
            f"WearMe V1 supports upper-body categories only: "
            f"{', '.join(sorted(SUPPORTED_UPPER_CATEGORIES))}."
        )

    def _build_payload(
        self,
        person_data_uri: str,
        garment_data_uri: str,
        fashn_category: str,
    ) -> dict:
        """Build the verified FASHN v1 `/v1/run` request body."""
        if self._model_name == "tryon-max":
            gen_mode = "fast" if self._mode == "performance" else self._mode
            if gen_mode not in {"fast", "balanced", "quality"}:
                gen_mode = "balanced"
            return {
                "model_name": "tryon-max",
                "inputs": {
                    "model_image": person_data_uri,
                    "product_image": garment_data_uri,
                    "generation_mode": gen_mode,
                    "resolution": "1k",
                    "output_format": "jpeg",
                    "return_base64": self._return_base64,
                },
            }

        mode = self._mode if self._mode in {"performance", "balanced", "quality"} else "balanced"
        return {
            "model_name": "tryon-v1.6",
            "inputs": {
                "model_image": person_data_uri,
                "garment_image": garment_data_uri,
                "category": fashn_category,
                "mode": mode,
                "garment_photo_type": self._garment_photo_type,
                "moderation_level": self._moderation_level,
                "output_format": "jpeg",
                "return_base64": self._return_base64,
            },
        }

    def _handle_http_error(self, response: httpx.Response, context: str) -> None:
        """Map FASHN API HTTP status codes to structured, user-safe VTONError instances."""
        status_code = response.status_code
        err_type = ""
        err_msg = ""
        try:
            data = response.json()
            if isinstance(data, dict):
                raw_err = data.get("error")
                if isinstance(raw_err, dict):
                    err_type = str(raw_err.get("name") or raw_err.get("type") or "")
                    err_msg = str(raw_err.get("message") or "")
                elif isinstance(raw_err, str):
                    err_type = raw_err
                    err_msg = str(data.get("message") or raw_err)
                else:
                    err_msg = str(data.get("message") or data.get("detail") or "")
        except Exception:
            err_msg = ""

        if status_code in (401, 403):
            raise VTONAuthError(
                "FASHN API authentication failed (HTTP 401). "
                "Please verify that AI_API_KEY is valid and active."
            )

        if status_code == 429:
            combined = f"{err_type} {err_msg}".lower()
            if "outofcredits" in combined or "credit" in combined:
                raise VTONQuotaError(
                    "FASHN API account has insufficient credits (OutOfCredits). "
                    "Please check your credit balance in the FASHN dashboard.",
                    retryable=False,
                )
            if "concurrency" in combined:
                raise VTONQuotaError(
                    "FASHN API concurrency limit reached (max 6 concurrent requests). "
                    "Please wait a few seconds and try again.",
                    retryable=True,
                )
            raise VTONQuotaError(
                "FASHN API rate limit exceeded. Please wait a moment and try again.",
                retryable=True,
            )

        if status_code == 400:
            safe_detail = err_msg or "Invalid request parameters or image format."
            raise VTONValidationError(f"FASHN API rejected the request: {safe_detail}")

        if status_code == 404:
            raise VTONProviderError(
                f"FASHN API resource not found during {context}.",
                retryable=False,
            )

        if status_code >= 500:
            raise VTONProviderError(
                f"FASHN API service encountered an upstream error (HTTP {status_code}). "
                "Please try again shortly.",
                retryable=True,
            )

        raise VTONProviderError(
            f"Unexpected FASHN API response (HTTP {status_code}) during {context}.",
            retryable=False,
        )

    def _raise_for_failed_prediction(self, prediction_id: str, error_obj: object) -> None:
        """Map FASHN runtime prediction errors (status == 'failed') to user-safe VTONErrors."""
        err_name = "PipelineError"
        err_message = "Prediction failed during execution."

        if isinstance(error_obj, dict):
            err_name = str(error_obj.get("name") or "PipelineError")
            err_message = str(error_obj.get("message") or err_message)
        elif isinstance(error_obj, str) and error_obj.strip():
            err_message = error_obj.strip()

        if err_name == "PoseError":
            raise VTONValidationError(
                "Unable to detect body pose in the person or garment image. "
                "Please use a clear, front-facing photo where the upper body is visible.",
                category="pose_error",
                prediction_id=prediction_id,
            )
        if err_name == "ContentModerationError":
            raise VTONValidationError(
                "The uploaded image could not be processed due to content moderation guidelines. "
                "Please try a different image.",
                category="moderation_error",
                prediction_id=prediction_id,
            )
        if err_name in ("ImageLoadError", "InputValidationError"):
            raise VTONValidationError(
                f"FASHN could not process the input image ({err_name}): {err_message}",
                category="validation_error",
                prediction_id=prediction_id,
            )

        # ThirdPartyError, UnavailableError, PipelineError -> 0 credits charged per FASHN docs
        raise VTONProviderError(
            f"FASHN inference failed ({err_name}): {err_message} "
            "(No API credits were consumed for this failed attempt.)",
            category="pipeline_error",
            retryable=True,
            prediction_id=prediction_id,
        )

    def _validate_output_url(self, output_url: str, prediction_id: str) -> str:
        """
        Validate that a provider-returned URL uses HTTPS and belongs strictly
        to the official FASHN CDN allowlist (prevents SSRF).
        """
        try:
            parsed = urlparse(output_url)
        except Exception as exc:
            raise VTONProviderError(
                "FASHN returned a malformed output URL.",
                prediction_id=prediction_id,
            ) from exc

        if parsed.scheme != "https":
            raise VTONProviderError(
                f"Blocked non-HTTPS output URL scheme '{parsed.scheme}'.",
                category="security_error",
                prediction_id=prediction_id,
            )

        hostname = (parsed.hostname or "").lower()
        if hostname not in ALLOWED_OUTPUT_HOSTS:
            raise VTONProviderError(
                f"Blocked untrusted output URL host '{hostname}'. "
                f"Allowed hosts: {', '.join(sorted(ALLOWED_OUTPUT_HOSTS))}.",
                category="security_error",
                prediction_id=prediction_id,
            )

        return output_url

    def _decode_and_verify_output_image(
        self, raw_bytes: bytes, prediction_id: str
    ) -> tuple[bytes, str]:
        """Verify that the output bytes decode as a valid image and determine its MIME type."""
        if not raw_bytes:
            raise VTONProviderError(
                "FASHN returned an empty output image.",
                prediction_id=prediction_id,
            )
        if len(raw_bytes) > MAX_OUTPUT_IMAGE_BYTES:
            raise VTONProviderError(
                "FASHN output image exceeded the maximum safe size (20 MB).",
                prediction_id=prediction_id,
            )
        try:
            with Image.open(io.BytesIO(raw_bytes)) as img:
                img.verify()
            with Image.open(io.BytesIO(raw_bytes)) as img2:
                fmt = (img2.format or "JPEG").upper()
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
            raise VTONProviderError(
                "FASHN returned corrupt or unreadable image data.",
                prediction_id=prediction_id,
            ) from exc

        mime_map = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
        return raw_bytes, mime_map.get(fmt, "image/jpeg")

    async def _resolve_output(
        self,
        client: httpx.AsyncClient,
        raw_output: str,
        prediction_id: str,
    ) -> tuple[bytes, str]:
        """
        Resolve FASHN `output[0]` which may be either:
        1. A base64 data URI (`data:image/jpeg;base64,...`) or raw base64 string when `return_base64=True`
        2. An HTTPS URL on `cdn.fashn.ai` or `media.fashn.ai` when `return_base64=False`
        """
        if raw_output.startswith("data:image/"):
            try:
                _, b64_part = raw_output.split(",", 1)
                decoded = base64.b64decode(b64_part)
            except Exception as exc:
                raise VTONProviderError(
                    "Failed to decode base64 data URI returned by FASHN.",
                    prediction_id=prediction_id,
                ) from exc
            return self._decode_and_verify_output_image(decoded, prediction_id)

        if raw_output.startswith("http://") or raw_output.startswith("https://"):
            safe_url = self._validate_output_url(raw_output, prediction_id)
            try:
                img_res = await client.get(safe_url, follow_redirects=False)
            except httpx.TimeoutException as exc:
                raise VTONTimeoutError(
                    "Timed out while downloading generated image from FASHN CDN.",
                    prediction_id=prediction_id,
                ) from exc
            except httpx.HTTPError as exc:
                raise VTONProviderError(
                    "Network error while downloading generated image from FASHN CDN.",
                    retryable=True,
                    prediction_id=prediction_id,
                ) from exc

            if img_res.status_code != 200:
                raise VTONProviderError(
                    f"Failed to download output image from FASHN CDN (HTTP {img_res.status_code}).",
                    prediction_id=prediction_id,
                )
            return self._decode_and_verify_output_image(img_res.content, prediction_id)

        # Fallback: raw base64 string without data URI prefix
        try:
            decoded = base64.b64decode(raw_output, validate=True)
            return self._decode_and_verify_output_image(decoded, prediction_id)
        except Exception as exc:
            raise VTONProviderError(
                "FASHN returned an unrecognized output format.",
                prediction_id=prediction_id,
            ) from exc

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
    ) -> tuple[bytes, str, dict]:
        start_ms = int(time.time() * 1000)

        # 1. Validate required configuration
        self.validate_config()

        # 2. Validate garment category and input images
        fashn_category = self._map_category(category)
        try:
            person_img = validate_and_encode_image(person_image_bytes, label="person_image")
            garment_img = validate_and_encode_image(garment_image_bytes, label="garment_image")
        except ImageValidationError as exc:
            raise VTONValidationError(str(exc)) from exc

        payload = self._build_payload(
            person_data_uri=person_img.data_uri,
            garment_data_uri=garment_img.data_uri,
            fashn_category=fashn_category,
        )
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        timeout_cfg = httpx.Timeout(
            timeout=min(30.0, self._timeout_sec),
            connect=10.0,
        )

        prediction_id: str | None = None
        credits_used: str | None = None

        try:
            async with httpx.AsyncClient(timeout=timeout_cfg) as client:
                # 3. Submit prediction to POST /v1/run
                # Only retry once on pre-connection failure or 502/503/504 to avoid duplicate paid runs.
                run_res: httpx.Response | None = None
                for attempt in range(2):
                    try:
                        run_res = await client.post(
                            f"{self.BASE_URL}/run",
                            json=payload,
                            headers=headers,
                        )
                    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                        if attempt == 0:
                            await asyncio.sleep(1.0)
                            continue
                        raise VTONProviderError(
                            "Could not connect to FASHN API (https://api.fashn.ai). "
                            "Please check network connectivity.",
                            retryable=True,
                        ) from exc
                    except httpx.TimeoutException as exc:
                        # Do NOT retry ReadTimeout/WriteTimeout on POST /v1/run to avoid double billing
                        raise VTONTimeoutError(
                            "Timed out while submitting try-on job to FASHN API."
                        ) from exc
                    except httpx.HTTPError as exc:
                        raise VTONProviderError(
                            "Network error while communicating with FASHN API.",
                            retryable=True,
                        ) from exc

                    if run_res.status_code in (502, 503, 504) and attempt == 0:
                        await asyncio.sleep(1.0)
                        continue
                    break

                assert run_res is not None
                if run_res.status_code != 200:
                    self._handle_http_error(run_res, context="POST /v1/run")

                try:
                    run_body = run_res.json()
                except Exception as exc:
                    raise VTONProviderError(
                        "FASHN API returned malformed JSON from /v1/run."
                    ) from exc

                if not isinstance(run_body, dict):
                    raise VTONProviderError("FASHN API returned an invalid response structure.")

                if run_body.get("error"):
                    self._raise_for_failed_prediction("unassigned", run_body.get("error"))

                raw_id = run_body.get("id")
                if not raw_id or not isinstance(raw_id, str):
                    raise VTONProviderError("FASHN API did not return a valid prediction ID.")
                prediction_id = raw_id

                logger.info(
                    "Submitted FASHN prediction job_id=%s prediction_id=%s model=%s category=%s",
                    job_id,
                    prediction_id,
                    self._model_name,
                    fashn_category,
                )

                # 4. Poll GET /v1/status/{prediction_id} until completed, failed, or deadline
                deadline = time.time() + self._timeout_sec
                consecutive_poll_errors = 0
                raw_output_item: str | None = None

                while time.time() < deadline:
                    try:
                        status_res = await client.get(
                            f"{self.BASE_URL}/status/{prediction_id}",
                            headers=headers,
                        )
                    except httpx.HTTPError as exc:
                        consecutive_poll_errors += 1
                        if consecutive_poll_errors > 3:
                            raise VTONProviderError(
                                f"Lost connection while polling FASHN prediction {prediction_id}.",
                                retryable=True,
                                prediction_id=prediction_id,
                            ) from exc
                        await asyncio.sleep(min(4.0, float(consecutive_poll_errors)))
                        continue

                    if status_res.status_code in (429, 500, 502, 503, 504):
                        consecutive_poll_errors += 1
                        if consecutive_poll_errors <= 3:
                            await asyncio.sleep(min(4.0, float(consecutive_poll_errors) * 1.5))
                            continue
                        self._handle_http_error(status_res, context="GET /v1/status")

                    if status_res.status_code != 200:
                        self._handle_http_error(status_res, context="GET /v1/status")

                    consecutive_poll_errors = 0
                    credits_used = status_res.headers.get("x-fashn-credits-used") or credits_used

                    try:
                        status_body = status_res.json()
                    except Exception as exc:
                        raise VTONProviderError(
                            "FASHN API returned malformed JSON from /v1/status.",
                            prediction_id=prediction_id,
                        ) from exc

                    if not isinstance(status_body, dict):
                        raise VTONProviderError(
                            "FASHN API status payload was not a JSON object.",
                            prediction_id=prediction_id,
                        )

                    status = status_body.get("status")
                    if status == "completed":
                        outputs = status_body.get("output")
                        if (
                            isinstance(outputs, list)
                            and len(outputs) > 0
                            and isinstance(outputs[0], str)
                            and outputs[0].strip()
                        ):
                            raw_output_item = outputs[0].strip()
                            break
                        raise VTONProviderError(
                            f"FASHN prediction {prediction_id} completed without an output image.",
                            prediction_id=prediction_id,
                        )

                    if status in ("failed", "canceled", "cancelled"):
                        self._raise_for_failed_prediction(prediction_id, status_body.get("error"))

                    if status in ("starting", "in_queue", "processing", "queued"):
                        await asyncio.sleep(self._poll_interval_sec)
                        continue

                    raise VTONProviderError(
                        f"FASHN API returned unexpected prediction status '{status}'.",
                        prediction_id=prediction_id,
                    )

                if not raw_output_item:
                    raise VTONTimeoutError(
                        f"FASHN virtual try-on timed out after {int(self._timeout_sec)} seconds "
                        f"(prediction_id={prediction_id}).",
                        prediction_id=prediction_id,
                    )

                # 5. Decode base64 output or safely download from allowlisted FASHN CDN
                result_bytes, result_mime = await self._resolve_output(
                    client=client,
                    raw_output=raw_output_item,
                    prediction_id=prediction_id,
                )

            elapsed_ms = int(time.time() * 1000) - start_ms
            logger.info(
                "Completed FASHN prediction job_id=%s prediction_id=%s model=%s duration_ms=%d credits_used=%s",
                job_id,
                prediction_id,
                self._model_name,
                elapsed_ms,
                credits_used or "1",
            )

            return (
                result_bytes,
                result_mime,
                {
                    "is_mock": False,
                    "prediction_id": prediction_id,
                    "model_name": self._model_name,
                    "mode": self._mode,
                    "fashn_category": fashn_category,
                    "return_base64": self._return_base64,
                    "credits_used": credits_used,
                    "elapsed_ms": elapsed_ms,
                },
            )
        except VTONError as err:
            elapsed_ms = int(time.time() * 1000) - start_ms
            logger.warning(
                "FASHN prediction failed job_id=%s prediction_id=%s category=%s duration_ms=%d message=%s",
                job_id,
                err.prediction_id or prediction_id or "none",
                err.category,
                elapsed_ms,
                err.message,
            )
            raise

    async def health_check(self) -> bool:
        """Return True if AI_API_KEY is configured."""
        return bool(self._api_key)
