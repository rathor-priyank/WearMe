import io
import time
from PIL import Image, ImageDraw
from .base import VTONProvider, VTONValidationError
from .image_validator import ImageValidationError, validate_and_encode_image

SUPPORTED_UPPER_CATEGORIES = {"TOP", "SHIRT", "TSHIRT", "JACKET"}


class MockProvider(VTONProvider):
    """
    Deterministic composite mock provider.

    Places the garment image as a semi-transparent overlay on the person image.
    Clearly watermarked so it is obvious this is not real AI output.

    Use ONLY to verify the pipeline is wired up correctly in local development
    and automated tests. Never silently fall back to MockProvider when a real
    provider is configured.
    """

    @property
    def name(self) -> str:
        return "mock"

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
    ) -> tuple[bytes, str, dict]:
        start_ms = int(time.time() * 1000)

        norm_category = (category or "").strip().upper()
        if norm_category not in SUPPORTED_UPPER_CATEGORIES:
            raise VTONValidationError(
                f"Unsupported garment category '{category}'. "
                f"Supported upper-body categories: {', '.join(sorted(SUPPORTED_UPPER_CATEGORIES))}."
            )

        try:
            validate_and_encode_image(person_image_bytes, label="person_image")
            validate_and_encode_image(garment_image_bytes, label="garment_image")
        except ImageValidationError as exc:
            raise VTONValidationError(str(exc)) from exc

        person = Image.open(io.BytesIO(person_image_bytes)).convert("RGBA")
        garment = Image.open(io.BytesIO(garment_image_bytes)).convert("RGBA")

        p_width, p_height = person.size

        # Resize garment to 40% of person width, maintain aspect ratio
        g_target_width = max(1, int(p_width * 0.4))
        ratio = g_target_width / max(1, garment.size[0])
        g_target_height = max(1, int(garment.size[1] * ratio))
        garment_resized = garment.resize((g_target_width, g_target_height), Image.LANCZOS)

        # Make garment semi-transparent (75% opacity)
        r, g, b, a = garment_resized.split()
        a = a.point(lambda x: int(x * 0.75))
        garment_resized = Image.merge("RGBA", (r, g, b, a))

        # Position: horizontally centered, vertically at ~25% from top (chest area)
        left = (p_width - g_target_width) // 2
        top = int(p_height * 0.25)

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

        return (
            result_bytes,
            "image/jpeg",
            {
                "is_mock": True,
                "composite_left": left,
                "composite_top": top,
                "garment_width": g_target_width,
                "garment_height": g_target_height,
                "person_width": p_width,
                "person_height": p_height,
                "elapsed_ms": elapsed,
            },
        )

    async def health_check(self) -> bool:
        return True
