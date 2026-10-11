import asyncio
import io
import logging
import tempfile
import time
from pathlib import Path
from PIL import Image, UnidentifiedImageError

from .base import (
    VTONError,
    VTONProvider,
    VTONProviderError,
    VTONQuotaError,
    VTONTimeoutError,
    VTONValidationError,
)
from .image_validator import ImageValidationError, validate_and_encode_image

logger = logging.getLogger("wearme.ai.huggingface")

SUPPORTED_UPPER_CATEGORIES = {
    "TOP": "upper body top",
    "SHIRT": "button-down shirt",
    "TSHIRT": "short sleeve round neck t-shirt",
    "JACKET": "upper body jacket",
}


class HuggingFaceProvider(VTONProvider):
    """
    Free Virtual Try-On provider using Hugging Face Spaces (`yisol/IDM-VTON`)
    via the official `gradio_client` SDK.

    - Works out-of-the-box for free without a credit card.
    - Supports an optional free Hugging Face token (`HF_TOKEN` or `AI_API_KEY`)
      from https://huggingface.co/settings/tokens for higher daily ZeroGPU quota.
    - IMPORTANT LICENSE NOTE: IDM-VTON is licensed under CC BY-NC-SA 4.0
      (non-commercial research/prototyping only). Use `fashn-api` for commercial deployments.
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

    def _run_gradio_sync(
        self,
        person_bytes: bytes,
        person_ext: str,
        garment_bytes: bytes,
        garment_ext: str,
        garment_des: str,
    ) -> bytes:
        from gradio_client import Client, handle_file

        with tempfile.TemporaryDirectory(prefix="wearme_hf_") as tmp_dir:
            tmp_path = Path(tmp_dir)
            person_path = tmp_path / f"person.{person_ext}"
            garment_path = tmp_path / f"garment.{garment_ext}"
            person_path.write_bytes(person_bytes)
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

            # `/tryon` returns (output_filepath, masked_image_filepath)
            out_item = result[0] if isinstance(result, (list, tuple)) and result else result
            if isinstance(out_item, dict):
                out_file_path = out_item.get("path") or out_item.get("url")
            else:
                out_file_path = str(out_item) if out_item else None

            if not out_file_path or not Path(out_file_path).is_file():
                raise VTONProviderError(
                    "Hugging Face Space completed but did not return a valid output image file."
                )

            return Path(out_file_path).read_bytes()

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
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

        try:
            raw_output_bytes = await asyncio.wait_for(
                asyncio.to_thread(
                    self._run_gradio_sync,
                    person_image_bytes,
                    person_ext,
                    garment_image_bytes,
                    garment_ext,
                    garment_des,
                ),
                timeout=self._timeout_sec,
            )
        except asyncio.TimeoutError as exc:
            raise VTONTimeoutError(
                f"Hugging Face Space ({self._space_id}) timed out after "
                f"{int(self._timeout_sec)} seconds. Public GPU queues may be busy."
            ) from exc
        except VTONError:
            raise
        except Exception as exc:
            msg = str(exc)
            lower_msg = msg.lower()
            if "quota" in lower_msg or "zerogpu" in lower_msg or "rate limit" in lower_msg:
                hint = (
                    "Please wait for your daily quota to reset."
                    if self._hf_token
                    else "Set a free HF_TOKEN from https://huggingface.co/settings/tokens in your .env file to get a larger personal free ZeroGPU quota."
                )
                raise VTONQuotaError(
                    f"Hugging Face free ZeroGPU quota reached: {msg} {hint}",
                    retryable=True,
                ) from exc
            raise VTONProviderError(
                f"Hugging Face VTON inference failed ({self._space_id}): {msg}",
                retryable=True,
            ) from exc

        # Validate & normalize output image to JPEG
        try:
            with Image.open(io.BytesIO(raw_output_bytes)) as img:
                img_rgb = img.convert("RGB")
                out_buf = io.BytesIO()
                img_rgb.save(out_buf, format="JPEG", quality=92)
                result_bytes = out_buf.getvalue()
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
            raise VTONProviderError(
                "Hugging Face Space returned unreadable or corrupt image data."
            ) from exc

        elapsed_ms = int(time.time() * 1000) - start_ms
        logger.info(
            "Completed Hugging Face VTON job_id=%s space=%s duration_ms=%d",
            job_id,
            self._space_id,
            elapsed_ms,
        )

        return (
            result_bytes,
            "image/jpeg",
            {
                "is_mock": False,
                "space_id": self._space_id,
                "garment_description": garment_des,
                "denoise_steps": self._denoise_steps,
                "authenticated_hf": bool(self._hf_token),
                "license": "CC BY-NC-SA 4.0 (Non-commercial research/dev only)",
                "elapsed_ms": elapsed_ms,
            },
        )

    async def health_check(self) -> bool:
        return True

