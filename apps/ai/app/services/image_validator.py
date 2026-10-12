import base64
import io
from dataclasses import dataclass
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
MIN_DIMENSION_PX = 64
MAX_DIMENSION_PX = 4096
MAX_DECOMPRESSED_PIXELS = MAX_DIMENSION_PX * MAX_DIMENSION_PX  # 16,777,216 pixels
MIN_ASPECT_RATIO = 1.0 / 16.0  # FASHN minimum aspect ratio 1:16
MAX_ASPECT_RATIO = 16.0  # FASHN maximum aspect ratio 16:1

# Guard against decompression bombs in Pillow before full image decode
Image.MAX_IMAGE_PIXELS = MAX_DECOMPRESSED_PIXELS

FORMAT_TO_MIME: dict[str, str] = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}


@dataclass(frozen=True)
class ValidatedImage:
    mime_type: str
    format_name: str
    width: int
    height: int
    byte_length: int
    data_uri: str


class ImageValidationError(ValueError):
    """Raised when an input or output image fails signature, format, or dimension validation."""

    pass


def _has_valid_magic_bytes(data: bytes) -> bool:
    """Verify file signature (magic bytes) for JPEG, PNG, or WebP."""
    if len(data) < 12:
        return False
    # JPEG: FF D8 FF
    if data[0] == 0xFF and data[1] == 0xD8 and data[2] == 0xFF:
        return True
    # PNG: 89 50 4E 47 0D 0A 1A 0A
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    # WebP: RIFF....WEBP
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    return False


def validate_and_encode_image(
    image_bytes: bytes,
    label: str = "image",
    max_bytes: int = MAX_IMAGE_BYTES,
) -> ValidatedImage:
    """
    Validate raw image bytes for size, magic bytes, structural integrity,
    supported format (JPEG, PNG, WEBP), and safe dimensions/aspect ratio.

    Returns a ValidatedImage including a properly prefixed base64 data URI.
    """
    if not image_bytes:
        raise ImageValidationError(f"{label} is empty.")

    if len(image_bytes) > max_bytes:
        max_mb = max_bytes / (1024 * 1024)
        raise ImageValidationError(
            f"{label} exceeds maximum file size of {max_mb:.0f} MB."
        )

    if not _has_valid_magic_bytes(image_bytes):
        raise ImageValidationError(
            f"{label} has an unsupported or invalid file signature. "
            "Only JPEG, PNG, and WebP images are supported."
        )

    try:
        # First pass: verify structural integrity
        with Image.open(io.BytesIO(image_bytes)) as verify_img:
            w_check, h_check = verify_img.size
            if w_check * h_check > MAX_DECOMPRESSED_PIXELS:
                raise Image.DecompressionBombError(
                    f"Image pixel count ({w_check * h_check}) exceeds limit ({MAX_DECOMPRESSED_PIXELS})."
                )
            verify_img.verify()

        # Second pass: read dimensions and fully decode pixels to catch truncated data
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.load()
            fmt = (img.format or "").upper()
            width, height = img.size
    except Image.DecompressionBombError as exc:
        raise ImageValidationError(
            f"{label} exceeds maximum safe pixel dimensions ({MAX_DIMENSION_PX}x{MAX_DIMENSION_PX}px)."
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ImageValidationError(
            f"{label} is corrupt or cannot be decoded as a valid image."
        ) from exc

    mime_type = FORMAT_TO_MIME.get(fmt)
    if not mime_type:
        raise ImageValidationError(
            f"{label} format '{fmt or 'unknown'}' is not supported. "
            "Please upload a JPEG, PNG, or WebP image."
        )

    if width < MIN_DIMENSION_PX or height < MIN_DIMENSION_PX:
        raise ImageValidationError(
            f"{label} dimensions ({width}x{height}px) are too small. "
            f"Minimum supported size is {MIN_DIMENSION_PX}x{MIN_DIMENSION_PX}px."
        )

    if width > MAX_DIMENSION_PX or height > MAX_DIMENSION_PX:
        raise ImageValidationError(
            f"{label} dimensions ({width}x{height}px) exceed the maximum "
            f"supported size of {MAX_DIMENSION_PX}x{MAX_DIMENSION_PX}px."
        )

    aspect_ratio = width / float(height)
    if aspect_ratio < MIN_ASPECT_RATIO or aspect_ratio > MAX_ASPECT_RATIO:
        raise ImageValidationError(
            f"{label} aspect ratio ({width}:{height}) is outside supported bounds (1:16 to 16:1)."
        )

    b64_str = base64.b64encode(image_bytes).decode("ascii")
    data_uri = f"data:{mime_type};base64,{b64_str}"

    return ValidatedImage(
        mime_type=mime_type,
        format_name=fmt,
        width=width,
        height=height,
        byte_length=len(image_bytes),
        data_uri=data_uri,
    )

