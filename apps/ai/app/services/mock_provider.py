import io
import time
from PIL import Image, ImageDraw
from .base import VTONProvider, VTONValidationError
from .image_validator import ImageValidationError, validate_and_encode_image
from .wearable_taxonomy import resolve_wearable_spec

SUPPORTED_UPPER_CATEGORIES = {"TOP", "SHIRT", "TSHIRT", "JACKET", "SWEATER", "HOODIE"}


class MockProvider(VTONProvider):
    """
    Deterministic composite mock provider.

    Places the garment/product image as a semi-transparent overlay on the target
    anatomical region of the person image. Clearly watermarked so it is obvious
    this is not real AI output.

    Use ONLY to verify the pipeline is wired up correctly in local development
    and automated tests. Never silently fall back to MockProvider when a real
    provider is configured.
    """

    def __init__(self, allow_extended_categories: bool = False) -> None:
        self._allow_extended = allow_extended_categories

    @property
    def name(self) -> str:
        return "mock"

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
        subcategory: str | None = None,
    ) -> tuple[bytes, str, dict]:
        start_ms = int(time.time() * 1000)

        norm_category = (subcategory or category or "").strip().upper()
        spec = resolve_wearable_spec(category, subcategory)

        if not self._allow_extended:
            if norm_category not in SUPPORTED_UPPER_CATEGORIES:
                raise VTONValidationError(
                    f"Unsupported garment category '{category}'. "
                    f"Supported upper-body categories: {', '.join(sorted(SUPPORTED_UPPER_CATEGORIES))}."
                )
        elif spec is None:
            raise VTONValidationError(
                f"Unsupported garment category '{subcategory or category}'."
            )

        try:
            validate_and_encode_image(person_image_bytes, label="person_image")
            validate_and_encode_image(garment_image_bytes, label="garment_image")
        except ImageValidationError as exc:
            raise VTONValidationError(str(exc)) from exc

        person = Image.open(io.BytesIO(person_image_bytes)).convert("RGBA")
        garment = Image.open(io.BytesIO(garment_image_bytes)).convert("RGBA")

        p_width, p_height = person.size

        if spec is not None and self._allow_extended:
            x1_n, y1_n, x2_n, y2_n = spec.mock_roi_box_norm
            box_w = max(16, int(p_width * (x2_n - x1_n)))
            box_h = max(16, int(p_height * (y2_n - y1_n)))
            scale = min(box_w / max(1, garment.size[0]), box_h / max(1, garment.size[1]))
            g_target_width = max(1, int(garment.size[0] * scale))
            g_target_height = max(1, int(garment.size[1] * scale))
            left = int(p_width * x1_n) + (box_w - g_target_width) // 2
            top = int(p_height * y1_n) + (box_h - g_target_height) // 2
        else:
            # Default V1 chest placement: 40% width, centered, 25% from top
            g_target_width = max(1, int(p_width * 0.4))
            ratio = g_target_width / max(1, garment.size[0])
            g_target_height = max(1, int(garment.size[1] * ratio))
            left = (p_width - g_target_width) // 2
            top = int(p_height * 0.25)

        garment_resized = garment.resize((g_target_width, g_target_height), Image.LANCZOS)

        # Make garment semi-transparent (75% opacity)
        r, g, b, a = garment_resized.split()
        a = a.point(lambda x: int(x * 0.75))
        garment_resized = Image.merge("RGBA", (r, g, b, a))

        result = person.copy()
        result.paste(garment_resized, (left, top), garment_resized)

        # Add a clear watermark label
        draw = ImageDraw.Draw(result)
        label = "MOCK MODE - Pipeline Test Only (Not Real AI)"
        text_bbox = draw.textbbox((0, 0), label)
        text_w = text_bbox[2] - text_bbox[0]
        text_h = text_bbox[3] - text_bbox[1]
        margin = 8
        box_x = (p_width - text_w) // 2 - margin
        box_y = p_height - text_h - 2 * margin - 10
        draw.rectangle(
            [box_x, box_y, box_x + text_w + 2 * margin, box_y + text_h + 2 * margin],
            fill=(0, 0, 0, 200),
        )
        draw.text((box_x + margin, box_y + margin), label, fill=(255, 215, 0, 255))

        # Convert to JPEG
        result_rgb = result.convert("RGB")
        output = io.BytesIO()
        result_rgb.save(output, format="JPEG", quality=90)
        result_bytes = output.getvalue()

        elapsed = int(time.time() * 1000) - start_ms

        meta: dict = {
            "is_mock": True,
            "composite_left": left,
            "composite_top": top,
            "garment_width": g_target_width,
            "garment_height": g_target_height,
            "person_width": p_width,
            "person_height": p_height,
            "elapsed_ms": elapsed,
        }
        if spec is not None:
            meta.update(
                {
                    "domain": spec.domain,
                    "subcategory": spec.subcategory,
                    "target_body_region": spec.target_body_region,
                    "required_landmarks": list(spec.required_landmarks),
                    "routing_strategy": spec.routing_strategy,
                    "live_validation_status": spec.live_validation_status,
                }
            )

        return (
            result_bytes,
            "image/jpeg",
            meta,
        )

    async def health_check(self) -> bool:
        return True

