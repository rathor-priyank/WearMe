import asyncio
import io
import logging
import re
import tempfile
import time
from pathlib import Path
import httpx
import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

from .base import (
    VTONAuthError,
    VTONError,
    VTONProvider,
    VTONProviderError,
    VTONQuotaError,
    VTONTimeoutError,
    VTONValidationError,
)
from .image_validator import ImageValidationError, validate_and_encode_image

logger = logging.getLogger("wearme.ai.huggingface")

VTON_CANVAS_W = 768
VTON_CANVAS_H = 1024

SUPPORTED_UPPER_CATEGORIES = {
    "TOP": "upper body top",
    "SHIRT": "button-down shirt",
    "TSHIRT": "short sleeve round neck t-shirt",
    "JACKET": "upper body jacket",
    "SWEATER": "long sleeve knitted sweater",
    "HOODIE": "hooded sweatshirt hoodie",
}

_HF_TOKEN_PATTERN = re.compile(r"\bhf_[A-Za-z0-9]{4,}\b", re.IGNORECASE)
_BEARER_PATTERN = re.compile(r"(Bearer\s+)[^\s,;\"']+", re.IGNORECASE)
_AUTH_HEADER_PATTERN = re.compile(
    r"(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;\"']+", re.IGNORECASE
)


def sanitize_upstream_message(raw_message: str, explicit_token: str | None = None) -> str:
    """
    Remove Hugging Face access tokens (`hf_...`), Bearer credentials, and
    Authorization headers from any upstream exception string so secrets can
    never appear in logs, API responses, or persisted job error messages.
    """
    if not raw_message:
        return "Unknown upstream error."

    sanitized = str(raw_message)
    if explicit_token and len(explicit_token) >= 4:
        sanitized = sanitized.replace(explicit_token, "[REDACTED_TOKEN]")

    sanitized = _HF_TOKEN_PATTERN.sub("[REDACTED_TOKEN]", sanitized)
    sanitized = _BEARER_PATTERN.sub(r"\1[REDACTED_TOKEN]", sanitized)
    sanitized = _AUTH_HEADER_PATTERN.sub(r"\1[REDACTED_TOKEN]", sanitized)
    sanitized = " ".join(sanitized.split())

    if len(sanitized) > 240:
        sanitized = sanitized[:237] + "..."
    return sanitized


def prepare_person_canvas(orig_img: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """
    Fit `orig_img` into a 768x1024 canvas WITHOUT stretching or squashing (preserves exact
    aspect ratio and person height). Edge pixels are replicated into any letterbox/pillarbox
    bars, and pixels near exact neutral gray RGB(127, 127, 127) are nudged by -7 so the
    upper-body mask returned by IDM-VTON's `mask_gray` output can be recovered losslessly.

    Returns:
        (canvas_768x1024, (pad_left, pad_top, fit_w, fit_h))
    """
    orig_w, orig_h = orig_img.size
    scale = min(VTON_CANVAS_W / float(orig_w), VTON_CANVAS_H / float(orig_h))
    fit_w = max(1, int(round(orig_w * scale)))
    fit_h = max(1, int(round(orig_h * scale)))

    resized = orig_img.resize((fit_w, fit_h), Image.LANCZOS)
    pad_left = (VTON_CANVAS_W - fit_w) // 2
    pad_top = (VTON_CANVAS_H - fit_h) // 2

    # Replicate edge pixels to fill the 768x1024 canvas naturally
    arr_resized = np.asarray(resized, dtype=np.uint8)
    pad_right = VTON_CANVAS_W - fit_w - pad_left
    pad_bottom = VTON_CANVAS_H - fit_h - pad_top
    canvas_arr = np.pad(
        arr_resized,
        ((pad_top, pad_bottom), (pad_left, pad_right), (0, 0)),
        mode="edge",
    )

    # De-collide exact neutral gray RGB(127..128, 127..128, 127..128) used by IDM-VTON's mask_gray
    near_mask_gray = (
        (canvas_arr[:, :, 0] >= 123)
        & (canvas_arr[:, :, 0] <= 132)
        & (canvas_arr[:, :, 1] >= 123)
        & (canvas_arr[:, :, 1] <= 132)
        & (canvas_arr[:, :, 2] >= 123)
        & (canvas_arr[:, :, 2] <= 132)
    )
    canvas_arr[near_mask_gray] = np.clip(
        canvas_arr[near_mask_gray].astype(np.int16) - 7, 0, 255
    ).astype(np.uint8)

    return Image.fromarray(canvas_arr, mode="RGB"), (pad_left, pad_top, fit_w, fit_h)


def _is_skin_pixel(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Detect skin-tone pixels in RGB (float32 0..255) using standard YCbCr/RGB skin heuristics
    so newly synthesized bare arms can be color-matched to the person's real face/neck/hands.
    """
    r = rgb_arr[:, :, 0]
    g = rgb_arr[:, :, 1]
    b = rgb_arr[:, :, 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b
    return (
        (r > 60)
        & (g > 40)
        & (b > 20)
        & (r > g)
        & (r > b)
        & ((r - np.minimum(g, b)) > 12)
        & (y > 45)
        & (cb >= 77)
        & (cb <= 135)
        & (cr >= 131)
        & (cr <= 180)
    )


def restore_unmasked_regions(
    orig_img: Image.Image,
    sent_canvas: Image.Image,
    vton_canvas: Image.Image,
    mask_gray_canvas: Image.Image | None,
    crop_box: tuple[int, int, int, int],
) -> Image.Image:
    """
    1. Recover the exact upper-body inpainting mask from `mask_gray_canvas` (where IDM-VTON
       fills masked pixels with flat neutral gray RGB(127, 127, 127)).
    2. Harmonize global VAE lighting & match newly generated arm skin tones to the person's
       original unmasked skin tone (face/neck/hands).
    3. Crop away any aspect-ratio padding, resize back to `orig_img.size`, and composite
       ONLY the upper-body mask region onto `orig_img` so the person's face, height,
       bottomwear (trousers/jeans), and background remain 100% untouched original pixels.
    """
    pad_left, pad_top, fit_w, fit_h = crop_box
    orig_w, orig_h = orig_img.size

    vton_768 = vton_canvas.convert("RGB").resize((VTON_CANVAS_W, VTON_CANVAS_H), Image.LANCZOS)
    sent_arr = np.asarray(sent_canvas, dtype=np.float32)
    vton_arr = np.asarray(vton_768, dtype=np.float32)

    if mask_gray_canvas is not None:
        mg_768 = mask_gray_canvas.convert("RGB").resize(
            (VTON_CANVAS_W, VTON_CANVAS_H), Image.NEAREST
        )
        mg_arr = np.asarray(mg_768, dtype=np.float32)
        # Pixels inside IDM-VTON's upper-body mask are flat RGB(127..128, 127..128, 127..128)
        is_masked = (
            (np.abs(mg_arr[:, :, 0] - 127.5) <= 4.5)
            & (np.abs(mg_arr[:, :, 1] - 127.5) <= 4.5)
            & (np.abs(mg_arr[:, :, 2] - 127.5) <= 4.5)
        )
    else:
        # Fallback if mask_gray was not returned: detect where vton differs strongly from input
        diff = np.max(np.abs(vton_arr - sent_arr), axis=2)
        is_masked = diff > 22.0

    # Restrict mask strictly to the active image box
    active_box_mask = np.zeros((VTON_CANVAS_H, VTON_CANVAS_W), dtype=bool)
    active_box_mask[pad_top : pad_top + fit_h, pad_left : pad_left + fit_w] = True
    is_masked = is_masked & active_box_mask

    # Step A: Correct subtle global VAE color/exposure shift using unmasked active pixels
    unmasked_active = (~is_masked) & active_box_mask
    if np.count_nonzero(unmasked_active) > 1000:
        for ch in range(3):
            orig_vals = sent_arr[:, :, ch][unmasked_active]
            vton_vals = vton_arr[:, :, ch][unmasked_active]
            v_mean = float(np.mean(vton_vals))
            o_mean = float(np.mean(orig_vals))
            v_std = max(1.0, float(np.std(vton_vals)))
            o_std = max(1.0, float(np.std(orig_vals)))
            gain = np.clip(o_std / v_std, 0.92, 1.08)
            bias = np.clip(o_mean - v_mean * gain, -12.0, 12.0)
            vton_arr[:, :, ch] = np.clip(vton_arr[:, :, ch] * gain + bias, 0.0, 255.0)

    # Step B: Match synthesized bare-arm skin tone inside the mask to original face/neck/hand skin tone
    orig_skin_mask = unmasked_active & _is_skin_pixel(sent_arr)
    vton_skin_mask = is_masked & _is_skin_pixel(vton_arr)
    if np.count_nonzero(orig_skin_mask) > 200 and np.count_nonzero(vton_skin_mask) > 200:
        skin_corrected = vton_arr.copy()
        for ch in range(3):
            ref_mean = float(np.mean(sent_arr[:, :, ch][orig_skin_mask]))
            ref_std = max(4.0, float(np.std(sent_arr[:, :, ch][orig_skin_mask])))
            gen_mean = float(np.mean(vton_arr[:, :, ch][vton_skin_mask]))
            gen_std = max(4.0, float(np.std(vton_arr[:, :, ch][vton_skin_mask])))

            scale_s = np.clip(ref_std / gen_std, 0.80, 1.25)
            shift_s = np.clip(ref_mean - gen_mean * scale_s, -28.0, 28.0)
            skin_corrected[:, :, ch] = np.clip(
                vton_arr[:, :, ch] * scale_s + shift_s, 0.0, 255.0
            )

        # Feather the skin mask so transitions at sleeve cuffs are smooth
        skin_mask_pil = Image.fromarray((vton_skin_mask.astype(np.uint8) * 255), mode="L")
        skin_mask_pil = skin_mask_pil.filter(ImageFilter.GaussianBlur(radius=3))
        skin_alpha = (np.asarray(skin_mask_pil, dtype=np.float32) / 255.0)[:, :, None]
        vton_arr = skin_alpha * skin_corrected + (1.0 - skin_alpha) * vton_arr

    corrected_vton_768 = Image.fromarray(vton_arr.astype(np.uint8), mode="RGB")

    # Step C: Crop out padding and resize both corrected VTON and mask back to original (orig_w, orig_h)
    cropped_vton = corrected_vton_768.crop(
        (pad_left, pad_top, pad_left + fit_w, pad_top + fit_h)
    ).resize((orig_w, orig_h), Image.LANCZOS)

    mask_768_pil = Image.fromarray((is_masked.astype(np.uint8) * 255), mode="L")
    # Dilate slightly (MaxFilter) then Gaussian-blur so seams blend smoothly
    mask_768_pil = mask_768_pil.filter(ImageFilter.MaxFilter(size=3))
    cropped_mask = mask_768_pil.crop(
        (pad_left, pad_top, pad_left + fit_w, pad_top + fit_h)
    ).resize((orig_w, orig_h), Image.BILINEAR)

    blur_radius = max(2, min(8, min(orig_w, orig_h) // 160))
    feathered_mask = cropped_mask.filter(ImageFilter.GaussianBlur(radius=blur_radius))

    # Composite: inside upper-body mask -> corrected VTON; outside mask -> 100% original photo!
    return Image.composite(cropped_vton, orig_img, feathered_mask)


class HuggingFaceProvider(VTONProvider):
    """
    Free Virtual Try-On provider using Hugging Face Spaces (`yisol/IDM-VTON`)
    via the official `gradio_client` SDK, enhanced with WearMe's post-processing
    pipeline that preserves 100% of the original face, height/aspect-ratio,
    bottomwear, and background while color-matching newly synthesized skin tones.
    """

    def __init__(
        self,
        hf_token: str = "",
        space_id: str = "yisol/IDM-VTON",
        timeout_seconds: float = 120.0,
        denoise_steps: int = 30,
        seed: int = 42,
    ) -> None:
        self._hf_token = (hf_token or "").strip() or None
        self._space_id = (space_id or "yisol/IDM-VTON").strip()
        self._timeout_sec = max(15.0, float(timeout_seconds))
        self._denoise_steps = max(20, min(40, int(denoise_steps)))
        self._seed = int(seed)

    @property
    def name(self) -> str:
        return "huggingface"

    def _map_category_description(self, category: str) -> str:
        norm = (category or "").strip().upper()
        if norm not in SUPPORTED_UPPER_CATEGORIES:
            raise VTONValidationError(
                f"Unsupported garment category '{category}'. "
                f"WearMe V1 supports upper-body categories only: "
                f"{', '.join(sorted(SUPPORTED_UPPER_CATEGORIES.keys()))}."
            )
        return SUPPORTED_UPPER_CATEGORIES[norm]

    def _classify_and_raise_error(self, exc: Exception) -> None:
        """
        Classify upstream Gradio / Hugging Face Hub / HTTP exceptions into
        structured, sanitized, user-safe VTONError subclasses.
        Never exposes raw access tokens or authorization headers.
        """
        if isinstance(exc, VTONError):
            raise exc

        safe_msg = sanitize_upstream_message(str(exc), explicit_token=self._hf_token)
        lower_msg = safe_msg.lower()

        # 1. Timeouts (retryable)
        if (
            isinstance(exc, (asyncio.TimeoutError, TimeoutError, httpx.TimeoutException))
            or "timed out" in lower_msg
            or "timeout" in lower_msg
        ):
            raise VTONTimeoutError(
                f"Hugging Face Space ({self._space_id}) timed out after "
                f"{int(self._timeout_sec)} seconds. Public GPU queues may be busy."
            ) from exc

        # 2. Authentication / Invalid or expired token (permanent until fixed)
        if any(
            token_kw in lower_msg
            for token_kw in (
                "401",
                "403",
                "unauthorized",
                "invalid token",
                "invalid credentials",
                "expired token",
                "token is invalid",
                "access denied",
                " bad request: invalid",
            )
        ):
            raise VTONAuthError(
                "Hugging Face authentication failed. Please verify that HF_TOKEN is valid "
                "and has read permissions."
            ) from exc

        # 3. ZeroGPU / Daily GPU Quota Exhaustion (non-retryable until quota resets or token added)
        if any(
            quota_kw in lower_msg
            for quota_kw in (
                "zerogpu",
                "gpu quota",
                "exceeded your quota",
                "daily quota",
                "out of quota",
                "quota exceeded",
                "free quota",
            )
        ):
            hint = (
                "Please wait for your Hugging Face ZeroGPU quota to reset."
                if self._hf_token
                else "Set a free HF_TOKEN from https://huggingface.co/settings/tokens in your .env file to get a larger personal free ZeroGPU quota."
            )
            raise VTONQuotaError(
                f"Hugging Face free ZeroGPU quota exhausted ({safe_msg}). {hint}",
                retryable=False,
            ) from exc

        # 4. Queue Full / Concurrency / Rate Limit (temporary, retryable)
        if any(
            queue_kw in lower_msg
            for queue_kw in (
                "queue is full",
                "queue full",
                "queue_full",
                "too many requests",
                "rate limit",
                "429",
                "overloaded",
                "concurrency limit",
            )
        ):
            raise VTONQuotaError(
                f"Hugging Face Space ({self._space_id}) queue is currently full or rate-limited. "
                "Please wait a moment and try again.",
                retryable=True,
            ) from exc

        # 5. Space Sleeping / Paused / Building / Unavailable / Connection Failure (temporary, retryable)
        if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)) or any(
            space_kw in lower_msg
            for space_kw in (
                "sleeping",
                "paused",
                "building",
                "not running",
                "runtime_error",
                "space is not",
                "502",
                "503",
                "504",
                "bad gateway",
                "service unavailable",
                "connection",
                "connecterror",
                "unreachable",
                "could not get",
            )
        ):
            raise VTONProviderError(
                f"Hugging Face Space ({self._space_id}) is currently sleeping, building, or "
                "unavailable. Please try again in a few moments.",
                category="space_unavailable",
                retryable=True,
            ) from exc

        # 6. Upstream API Schema Changes / Unexpected Signature (permanent)
        if isinstance(exc, (KeyError, TypeError)) or any(
            schema_kw in lower_msg
            for schema_kw in (
                "api_name",
                "/tryon",
                "endpoint",
                "unexpected keyword",
                "missing 1 required",
                "positional argument",
                "parameter",
                "schema",
            )
        ):
            raise VTONProviderError(
                f"Hugging Face Space ({self._space_id}) API schema changed or rejected parameters: "
                f"{safe_msg}",
                category="schema_mismatch",
                retryable=False,
            ) from exc

        # 7. Default sanitized provider error
        raise VTONProviderError(
            f"Hugging Face VTON inference failed ({self._space_id}): {safe_msg}",
            category="provider_error",
            retryable=False,
        ) from exc

    def _run_gradio_sync(
        self,
        person_bytes: bytes,
        person_ext: str,
        garment_bytes: bytes,
        garment_ext: str,
        garment_des: str,
        debug_artifact_dir: Path | str | None = None,
    ) -> tuple[bytes, dict[str, str]]:
        from gradio_client import Client, handle_file

        # 1. Load original person image with EXIF orientation applied
        with Image.open(io.BytesIO(person_bytes)) as raw_person:
            orig_person = ImageOps.exif_transpose(raw_person).convert("RGB")

        sent_canvas, crop_box = prepare_person_canvas(orig_person)

        with tempfile.TemporaryDirectory(prefix="wearme_hf_") as tmp_dir:
            tmp_path = Path(tmp_dir)
            person_path = tmp_path / "person_canvas.png"
            garment_path = tmp_path / f"garment.{garment_ext}"
            sent_canvas.save(person_path, format="PNG")
            garment_path.write_bytes(garment_bytes)

            client = Client(
                self._space_id,
                token=self._hf_token,
                download_files=str(tmp_path),
                verbose=False,
            )

            result = client.predict(
                dict={
                    "background": handle_file(str(person_path)),
                    "layers": [],
                    "composite": None,
                },
                garm_img=handle_file(str(garment_path)),
                garment_des=garment_des,
                is_checked=True,
                is_checked_crop=False,
                denoise_steps=self._denoise_steps,
                seed=self._seed,
                api_name="/tryon",
            )

            def _extract_path(item: object) -> str | None:
                if isinstance(item, dict):
                    val = item.get("path") or item.get("url")
                    return str(val) if isinstance(val, str) and val.strip() else None
                if isinstance(item, (str, Path)):
                    s = str(item).strip()
                    return s if s else None
                return None

            if not isinstance(result, (list, tuple)) or len(result) < 1:
                raise VTONProviderError(
                    f"Hugging Face Space ({self._space_id}) returned an unexpected output "
                    "structure (expected a tuple of filepaths from /tryon).",
                    category="schema_mismatch",
                    retryable=False,
                )

            out_file_path = _extract_path(result[0])
            mask_file_path = _extract_path(result[1]) if len(result) > 1 else None

            if not out_file_path or not Path(out_file_path).is_file():
                raise VTONProviderError(
                    f"Hugging Face Space ({self._space_id}) completed but did not return a "
                    "valid output image file.",
                    category="schema_mismatch",
                    retryable=False,
                )

            try:
                with Image.open(out_file_path) as vton_img:
                    vton_canvas = vton_img.convert("RGB")
            except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
                raise VTONProviderError(
                    f"Hugging Face Space ({self._space_id}) returned corrupt or unreadable image data.",
                    category="schema_mismatch",
                    retryable=False,
                ) from exc

            mask_gray_canvas: Image.Image | None = None
            if mask_file_path and Path(mask_file_path).is_file():
                try:
                    with Image.open(mask_file_path) as m_img:
                        mask_gray_canvas = m_img.convert("RGB")
                except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
                    mask_gray_canvas = None

            # Restore 100% original face, height, bottomwear, and background + harmonize skin tone
            final_img = restore_unmasked_regions(
                orig_img=orig_person,
                sent_canvas=sent_canvas,
                vton_canvas=vton_canvas,
                mask_gray_canvas=mask_gray_canvas,
                crop_box=crop_box,
            )

            out_buf = io.BytesIO()
            final_img.save(out_buf, format="JPEG", quality=95)
            final_bytes = out_buf.getvalue()

            debug_artifacts: dict[str, str] = {}
            if debug_artifact_dir is not None:
                dbg_dir = Path(debug_artifact_dir)
                dbg_dir.mkdir(parents=True, exist_ok=True)

                p_orig_file = dbg_dir / f"01_person_orig.{person_ext}"
                g_orig_file = dbg_dir / f"02_garment_orig.{garment_ext}"
                p_prep_file = dbg_dir / "03_person_preprocessed.png"
                raw_out_file = dbg_dir / "04_provider_raw_output.png"
                raw_unpadded_file = dbg_dir / "04b_provider_raw_unpadded.jpg"
                final_comp_file = dbg_dir / "06_final_composited.jpg"

                p_orig_file.write_bytes(person_bytes)
                g_orig_file.write_bytes(garment_bytes)
                sent_canvas.save(p_prep_file, format="PNG")
                vton_canvas.save(raw_out_file, format="PNG")

                # Also save uncomposited raw provider output unpadded to original dimensions
                pad_left, pad_top, fit_w, fit_h = crop_box
                vton_768 = vton_canvas.resize((VTON_CANVAS_W, VTON_CANVAS_H), Image.LANCZOS)
                raw_unpadded = vton_768.crop(
                    (pad_left, pad_top, pad_left + fit_w, pad_top + fit_h)
                ).resize(orig_person.size, Image.LANCZOS)
                raw_unpadded.save(raw_unpadded_file, format="JPEG", quality=95)

                final_comp_file.write_bytes(final_bytes)

                debug_artifacts = {
                    "person_orig": str(p_orig_file),
                    "garment_orig": str(g_orig_file),
                    "person_preprocessed": str(p_prep_file),
                    "provider_raw_output": str(raw_out_file),
                    "provider_raw_unpadded": str(raw_unpadded_file),
                    "final_composited": str(final_comp_file),
                }

                if mask_gray_canvas is not None:
                    raw_mask_file = dbg_dir / "05_provider_mask.png"
                    mask_gray_canvas.save(raw_mask_file, format="PNG")
                    debug_artifacts["provider_mask"] = str(raw_mask_file)

            return final_bytes, debug_artifacts

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
        debug_artifact_dir: Path | str | None = None,
    ) -> tuple[bytes, str, dict]:
        start_ms = int(time.time() * 1000)

        garment_des = self._map_category_description(category)
        try:
            person_img = validate_and_encode_image(person_image_bytes, label="person_image")
            garment_img = validate_and_encode_image(garment_image_bytes, label="garment_image")
        except ImageValidationError as exc:
            raise VTONValidationError(str(exc)) from exc

        ext_map = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
        person_ext = ext_map.get(person_img.format_name, "jpg")
        garment_ext = ext_map.get(garment_img.format_name, "jpg")

        logger.info(
            "Submitting Hugging Face VTON job_id=%s space=%s category=%s auth=%s",
            job_id,
            self._space_id,
            category,
            bool(self._hf_token),
        )

        debug_artifacts: dict[str, str] = {}
        try:
            gradio_args = (
                (
                    person_image_bytes,
                    person_ext,
                    garment_image_bytes,
                    garment_ext,
                    garment_des,
                )
                if debug_artifact_dir is None
                else (
                    person_image_bytes,
                    person_ext,
                    garment_image_bytes,
                    garment_ext,
                    garment_des,
                    debug_artifact_dir,
                )
            )
            sync_res = await asyncio.wait_for(
                asyncio.to_thread(
                    self._run_gradio_sync,
                    *gradio_args,
                ),
                timeout=self._timeout_sec,
            )
            if isinstance(sync_res, tuple) and len(sync_res) == 2:
                raw_output_bytes, debug_artifacts = sync_res
            else:
                raw_output_bytes = sync_res  # type: ignore[assignment]
        except Exception as exc:
            try:
                self._classify_and_raise_error(exc)
            except VTONError as classified_err:
                elapsed_ms = int(time.time() * 1000) - start_ms
                logger.warning(
                    "Hugging Face VTON failed job_id=%s space=%s category=%s retryable=%s duration_ms=%d message=%s",
                    job_id,
                    self._space_id,
                    classified_err.category,
                    classified_err.retryable,
                    elapsed_ms,
                    classified_err.message,
                )
                raise

        # Validate output image
        try:
            with Image.open(io.BytesIO(raw_output_bytes)) as img:
                img.verify()
            result_bytes = raw_output_bytes
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
            raise VTONProviderError(
                "Hugging Face Space returned unreadable or corrupt image data.",
                category="schema_mismatch",
                retryable=False,
            ) from exc

        elapsed_ms = int(time.time() * 1000) - start_ms
        logger.info(
            "Completed Hugging Face VTON job_id=%s space=%s duration_ms=%d",
            job_id,
            self._space_id,
            elapsed_ms,
        )

        meta: dict = {
            "is_mock": False,
            "space_id": self._space_id,
            "garment_description": garment_des,
            "denoise_steps": self._denoise_steps,
            "authenticated_hf": bool(self._hf_token),
            "preserved_unmasked_regions": True,
            "license": "CC BY-NC-SA 4.0 (Non-commercial research/dev only)",
            "elapsed_ms": elapsed_ms,
        }
        if debug_artifacts:
            meta["debug_artifacts"] = debug_artifacts

        return (
            result_bytes,
            "image/jpeg",
            meta,
        )

    async def health_check(self) -> bool:
        return True

