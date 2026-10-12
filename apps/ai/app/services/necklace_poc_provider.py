from dataclasses import asdict, dataclass
import io
import logging
import math
from pathlib import Path
import time
from typing import Any, Callable
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

from .base import (
    VTONConfigError,
    VTONError,
    VTONProvider,
    VTONProviderError,
    VTONTimeoutError,
    VTONValidationError,
)
from .image_validator import ImageValidationError, validate_and_encode_image

logger = logging.getLogger("wearme.ai.necklace_poc")

SUPPORTED_NECKLACE_SUBCATEGORIES = frozenset({"NECKLACE", "PENDANT"})

MIN_PERSON_WIDTH_PX = 160
MIN_PERSON_HEIGHT_PX = 160
MIN_SHOULDER_SPAN_PX = 72.0
MAX_ABS_YAW_DEG = 25.0
MAX_ABS_ROLL_DEG = 18.0
MIN_LANDMARK_CONFIDENCE = 0.55
MIN_VISIBLE_ALPHA_RETENTION = 0.30


@dataclass(frozen=True)
class NeckClavicleLandmarks:
    """Estimated anatomical keypoints and pose parameters for the neck/clavicle region."""

    chin_xy: tuple[float, float]
    jaw_left_xy: tuple[float, float]
    jaw_right_xy: tuple[float, float]
    shoulder_left_xy: tuple[float, float]
    shoulder_right_xy: tuple[float, float]
    suprasternal_notch_xy: tuple[float, float]
    clavicle_left_xy: tuple[float, float]
    clavicle_right_xy: tuple[float, float]
    shoulder_width_px: float
    yaw_deg: float
    roll_deg: float
    confidence: float
    detector_backend: str
    verified_anatomical: bool = False


@dataclass(frozen=True)
class SegmentedJewellery:
    """Segmented RGBA jewellery product and canonical control points."""

    rgba_crop: Image.Image
    alpha_mask: Image.Image
    bbox: tuple[int, int, int, int]
    foreground_ratio: float
    aspect_ratio: float
    anchor_left_xy: tuple[float, float]
    anchor_right_xy: tuple[float, float]
    anchor_drop_xy: tuple[float, float]
    segmentation_method: str


def validate_landmarks_plausibility(
    landmarks: NeckClavicleLandmarks,
    person_size: tuple[int, int],
) -> None:
    """
    Validate landmark confidence, finite numeric values, pose envelope, and
    anatomical geometric ordering before attempting placement or warping.
    """
    pw, ph = person_size
    all_points = (
        landmarks.chin_xy,
        landmarks.jaw_left_xy,
        landmarks.jaw_right_xy,
        landmarks.shoulder_left_xy,
        landmarks.shoulder_right_xy,
        landmarks.suprasternal_notch_xy,
        landmarks.clavicle_left_xy,
        landmarks.clavicle_right_xy,
    )
    for pt in all_points:
        if (
            not isinstance(pt, (tuple, list))
            or len(pt) != 2
            or not math.isfinite(float(pt[0]))
            or not math.isfinite(float(pt[1]))
        ):
            raise VTONValidationError(
                "Detected landmarks contain non-finite (NaN or Inf) coordinates.",
                category="unreliable_landmarks",
            )

    for scalar in (
        landmarks.shoulder_width_px,
        landmarks.yaw_deg,
        landmarks.roll_deg,
        landmarks.confidence,
    ):
        if not math.isfinite(float(scalar)):
            raise VTONValidationError(
                "Detected landmark pose or confidence parameters are non-finite.",
                category="unreliable_landmarks",
            )

    if landmarks.confidence < MIN_LANDMARK_CONFIDENCE:
        raise VTONValidationError(
            f"Landmark detection confidence ({landmarks.confidence:.2f}) is below minimum threshold "
            f"({MIN_LANDMARK_CONFIDENCE:.2f}).",
            category="unreliable_landmarks",
        )

    if landmarks.shoulder_width_px < MIN_SHOULDER_SPAN_PX:
        raise VTONValidationError(
            f"Detected shoulder span ({landmarks.shoulder_width_px:.1f}px) is too narrow for necklace placement "
            f"(minimum {MIN_SHOULDER_SPAN_PX:.0f}px).",
            category="unreliable_landmarks",
        )

    if abs(landmarks.yaw_deg) > MAX_ABS_YAW_DEG or abs(landmarks.roll_deg) > MAX_ABS_ROLL_DEG:
        raise VTONValidationError(
            f"Unsuitable pose for necklace try-on (estimated yaw={landmarks.yaw_deg:.1f}°, "
            f"roll={landmarks.roll_deg:.1f}°; limits: |yaw|<={MAX_ABS_YAW_DEG:.0f}°, "
            f"|roll|<={MAX_ABS_ROLL_DEG:.0f}°).",
            category="unsuitable_pose",
        )

    # Check bounds
    for x, y in all_points:
        if x < 0.0 or x > float(pw) or y < 0.0 or y > float(ph):
            raise VTONValidationError(
                f"Detected landmark ({x:.1f}, {y:.1f}) lies outside person image bounds ({pw}x{ph}).",
                category="unreliable_landmarks",
            )

    # Horizontal anatomical ordering: jaw_left < chin < jaw_right
    if not (landmarks.jaw_left_xy[0] < landmarks.chin_xy[0] < landmarks.jaw_right_xy[0]):
        raise VTONValidationError(
            "Anatomically implausible jawline/chin horizontal ordering.",
            category="unreliable_landmarks",
        )

    # Horizontal ordering: shoulder_left < clavicle_left < notch < clavicle_right < shoulder_right
    if not (
        landmarks.shoulder_left_xy[0]
        < landmarks.clavicle_left_xy[0]
        < landmarks.suprasternal_notch_xy[0]
        < landmarks.clavicle_right_xy[0]
        < landmarks.shoulder_right_xy[0]
    ):
        raise VTONValidationError(
            "Anatomically implausible shoulder/clavicle horizontal ordering (inverted anchors).",
            category="unreliable_landmarks",
        )

    # Vertical ordering: jaw above chin, chin above suprasternal notch
    if not (
        min(landmarks.jaw_left_xy[1], landmarks.jaw_right_xy[1])
        <= landmarks.chin_xy[1]
        < landmarks.suprasternal_notch_xy[1]
    ):
        raise VTONValidationError(
            "Anatomically implausible vertical ordering: chin must lie above suprasternal notch.",
            category="unreliable_landmarks",
        )


def _compute_skin_mask(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Compute a boolean skin-likelihood mask across diverse skin tones using
    combined YCbCr and normalized RGB chromaticity thresholds.
    """
    r = rgb_arr[:, :, 0].astype(np.float32)
    g = rgb_arr[:, :, 1].astype(np.float32)
    b = rgb_arr[:, :, 2].astype(np.float32)

    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128.0 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128.0 + 0.5 * r - 0.418688 * g - 0.081312 * b

    ycbcr_skin = (
        (y >= 35.0)
        & (y <= 248.0)
        & (cb >= 75.0)
        & (cb <= 138.0)
        & (cr >= 128.0)
        & (cr <= 182.0)
        & (r > b)
    )
    return ycbcr_skin


def _compute_foreground_silhouette(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Estimate person foreground silhouette relative to the top-left and top-right
    background corners.
    """
    h, w, _ = rgb_arr.shape
    patch_h = max(4, h // 16)
    patch_w = max(4, w // 16)
    corners = np.concatenate(
        [
            rgb_arr[:patch_h, :patch_w, :].reshape(-1, 3),
            rgb_arr[:patch_h, w - patch_w :, :].reshape(-1, 3),
        ],
        axis=0,
    ).astype(np.float32)
    bg_color = np.median(corners, axis=0)
    diff = np.linalg.norm(rgb_arr.astype(np.float32) - bg_color[None, None, :], axis=2)
    return diff > 18.0


def _try_mediapipe_landmarks(person_rgb: Image.Image) -> NeckClavicleLandmarks | None:
    """
    Attempt anatomical landmark detection via MediaPipe Pose + FaceMesh if installed.
    Returns None ONLY when the `mediapipe` package is not installed; if MediaPipe IS
    installed and fails to detect a face/pose, raises `VTONValidationError` directly
    without falling back to heuristic contours.
    """
    try:
        import mediapipe as mp  # type: ignore
    except ImportError:
        return None

    w, h = person_rgb.size
    rgb_arr = np.asarray(person_rgb.convert("RGB"), dtype=np.uint8)

    with mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=1,
        min_detection_confidence=0.55,
    ) as pose_detector, mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        min_detection_confidence=0.55,
    ) as face_detector:
        pose_res = pose_detector.process(rgb_arr)
        face_res = face_detector.process(rgb_arr)

        if not pose_res.pose_landmarks or not face_res.multi_face_landmarks:
            raise VTONValidationError(
                "MediaPipe anatomical detector could not locate both face and upper-body pose landmarks.",
                category="no_detectable_face_or_neck",
            )

        plm = pose_res.pose_landmarks.landmark
        flm = face_res.multi_face_landmarks[0].landmark

        # MediaPipe Pose: 11 = left shoulder (person's left, image right), 12 = right shoulder (image left)
        sh_r = plm[12]
        sh_l = plm[11]
        vis = float(min(getattr(sh_r, "visibility", 0.0), getattr(sh_l, "visibility", 0.0)))
        if vis < MIN_LANDMARK_CONFIDENCE:
            raise VTONValidationError(
                f"MediaPipe shoulder landmark visibility ({vis:.2f}) is below threshold ({MIN_LANDMARK_CONFIDENCE}).",
                category="unreliable_landmarks",
            )

        sh_left_x, sh_left_y = float(sh_r.x * w), float(sh_r.y * h)
        sh_right_x, sh_right_y = float(sh_l.x * w), float(sh_l.y * h)
        shoulder_width_px = sh_right_x - sh_left_x

        # MediaPipe FaceMesh: 152 = chin tip, 234 = image-left jaw, 454 = image-right jaw
        chin_pt = flm[152]
        jaw_l_pt = flm[234]
        jaw_r_pt = flm[454]

        chin_x, chin_y = float(chin_pt.x * w), float(chin_pt.y * h)
        jaw_left_x, jaw_left_y = float(jaw_l_pt.x * w), float(jaw_l_pt.y * h)
        jaw_right_x, jaw_right_y = float(jaw_r_pt.x * w), float(jaw_r_pt.y * h)

        mid_sh_x = 0.5 * (sh_left_x + sh_right_x)
        mid_sh_y = 0.5 * (sh_left_y + sh_right_y)
        roll_deg = math.degrees(math.atan2(sh_right_y - sh_left_y, max(1.0, shoulder_width_px)))

        left_jaw_span = max(1.0, chin_x - jaw_left_x)
        right_jaw_span = max(1.0, jaw_right_x - chin_x)
        jaw_asym = (right_jaw_span - left_jaw_span) / (right_jaw_span + left_jaw_span)
        yaw_deg = float(np.clip(jaw_asym * 55.0, -45.0, 45.0))

        notch_x = 0.65 * chin_x + 0.35 * mid_sh_x
        notch_y = 0.28 * chin_y + 0.72 * mid_sh_y
        clav_half_span = 0.18 * shoulder_width_px
        left_scale = 1.0 - 0.22 * math.sin(math.radians(yaw_deg))
        right_scale = 1.0 + 0.22 * math.sin(math.radians(yaw_deg))

        clav_left_x = notch_x - clav_half_span * left_scale
        clav_right_x = notch_x + clav_half_span * right_scale
        clav_left_y = notch_y - 0.02 * shoulder_width_px + math.tan(math.radians(roll_deg)) * (-clav_half_span)
        clav_right_y = notch_y - 0.02 * shoulder_width_px + math.tan(math.radians(roll_deg)) * clav_half_span

        lm = NeckClavicleLandmarks(
            chin_xy=(round(chin_x, 2), round(chin_y, 2)),
            jaw_left_xy=(round(jaw_left_x, 2), round(jaw_left_y, 2)),
            jaw_right_xy=(round(jaw_right_x, 2), round(jaw_right_y, 2)),
            shoulder_left_xy=(round(sh_left_x, 2), round(sh_left_y, 2)),
            shoulder_right_xy=(round(sh_right_x, 2), round(sh_right_y, 2)),
            suprasternal_notch_xy=(round(notch_x, 2), round(notch_y, 2)),
            clavicle_left_xy=(round(clav_left_x, 2), round(clav_left_y, 2)),
            clavicle_right_xy=(round(clav_right_x, 2), round(clav_right_y, 2)),
            shoulder_width_px=round(shoulder_width_px, 2),
            yaw_deg=round(yaw_deg, 2),
            roll_deg=round(roll_deg, 2),
            confidence=round(vis, 3),
            detector_backend="mediapipe_pose_facemesh",
            verified_anatomical=True,
        )
        validate_landmarks_plausibility(lm, (w, h))
        return lm


def detect_neck_clavicle_landmarks(person_rgb: Image.Image) -> NeckClavicleLandmarks:
    """
    Detect chin, neck, suprasternal notch, shoulder, and medial clavicle landmarks.

    1. Attempts MediaPipe Pose + FaceMesh first if installed (`verified_anatomical=True`).
    2. When MediaPipe is not installed in the Python environment, uses a heuristic
       skin + upper-body silhouette contour estimator (`detector_backend="heuristic_skin_silhouette_fallback"`,
       `verified_anatomical=False`).
    3. Enforces anatomical constriction and geometric plausibility checks; never fabricates
       default landmarks when head/neck/shoulder structure is missing.
    """
    w, h = person_rgb.size
    if w < MIN_PERSON_WIDTH_PX or h < MIN_PERSON_HEIGHT_PX:
        raise VTONValidationError(
            f"Person image resolution ({w}x{h}px) is too low for reliable neck/clavicle "
            f"landmark detection (minimum {MIN_PERSON_WIDTH_PX}x{MIN_PERSON_HEIGHT_PX}px).",
            category="unreliable_landmarks",
        )

    rgb_arr = np.asarray(person_rgb.convert("RGB"), dtype=np.uint8)
    if float(np.std(rgb_arr)) < 4.0:
        raise VTONValidationError(
            "No detectable face or neck found: person image appears uniform or blank.",
            category="no_detectable_face_or_neck",
        )

    mp_landmarks = _try_mediapipe_landmarks(person_rgb)
    if mp_landmarks is not None:
        return mp_landmarks

    skin_mask = _compute_skin_mask(rgb_arr)
    fg_mask = _compute_foreground_silhouette(rgb_arr) | skin_mask

    # Search upper-half ROI for head/neck skin and torso shoulders
    y_head_start = int(h * 0.05)
    y_neck_end = int(h * 0.52)
    upper_skin = skin_mask[y_head_start:y_neck_end, :]
    skin_ratio = float(np.mean(upper_skin))

    if skin_ratio < 0.025 or skin_ratio > 0.72:
        raise VTONValidationError(
            "No detectable face or neck skin region in the upper portrait area. "
            "Please upload a clear, front-facing upper-body photo with an unobstructed neck.",
            category="no_detectable_face_or_neck",
        )

    # Compute row-wise horizontal skin span in the upper portrait
    row_counts = np.sum(skin_mask, axis=1)
    valid_skin_rows = np.where(row_counts >= max(6, int(w * 0.05)))[0]
    valid_skin_rows = valid_skin_rows[
        (valid_skin_rows >= int(h * 0.06)) & (valid_skin_rows <= int(h * 0.55))
    ]
    if len(valid_skin_rows) < max(8, int(h * 0.06)):
        raise VTONValidationError(
            "Unable to localize a continuous face and neck region in person image.",
            category="no_detectable_face_or_neck",
        )

    top_skin_y = int(valid_skin_rows[0])
    bottom_skin_y = int(valid_skin_rows[-1])
    span_h = max(1, bottom_skin_y - top_skin_y)

    chin_y = float(top_skin_y + 0.56 * span_h)
    neck_base_y = float(min(h * 0.44, top_skin_y + 0.80 * span_h))

    # Measure horizontal skin center and width around chin/jaw
    chin_band_y0 = max(0, int(chin_y - max(2, h * 0.02)))
    chin_band_y1 = min(h, int(chin_y + max(3, h * 0.02)))
    xs_chin = np.where(np.any(skin_mask[chin_band_y0:chin_band_y1, :], axis=0))[0]
    if len(xs_chin) < max(6, int(w * 0.05)):
        raise VTONValidationError(
            "Unreliable chin/jawline landmarks in person image.",
            category="unreliable_landmarks",
        )

    jaw_left_x = float(np.percentile(xs_chin, 10))
    jaw_right_x = float(np.percentile(xs_chin, 90))
    jaw_span_px = jaw_right_x - jaw_left_x
    chin_x = float(np.median(xs_chin))

    if jaw_span_px > 0.78 * w or jaw_span_px < 12.0:
        raise VTONValidationError(
            "No anatomical head/neck contour detected (jaw span is implausible).",
            category="no_detectable_face_or_neck",
        )

    # Estimate shoulder span from foreground silhouette in torso band [neck_base_y .. neck_base_y + 0.16*h]
    sh_y0 = max(0, int(neck_base_y))
    sh_y1 = min(h, int(neck_base_y + h * 0.16))
    torso_fg = fg_mask[sh_y0:sh_y1, :]
    xs_torso = np.where(np.any(torso_fg, axis=0))[0]
    if len(xs_torso) < max(20, int(w * 0.22)):
        raise VTONValidationError(
            "Could not detect clear left and right shoulders below the neck.",
            category="unreliable_landmarks",
        )

    sh_left_x = float(np.percentile(xs_torso, 5))
    sh_right_x = float(np.percentile(xs_torso, 95))
    shoulder_width_px = sh_right_x - sh_left_x

    # Anatomical plausibility: shoulder span must be meaningfully wider than the jawline/neck
    if shoulder_width_px < 1.15 * jaw_span_px:
        raise VTONValidationError(
            "Anatomical structure check failed: shoulder silhouette is not wider than the head/neck contour.",
            category="no_detectable_face_or_neck",
        )

    # Estimate left vs right shoulder vertical profile for roll angle
    left_col_ys = np.where(fg_mask[int(h * 0.18) : int(h * 0.55), int(sh_left_x)])[0]
    right_col_ys = np.where(fg_mask[int(h * 0.18) : int(h * 0.55), int(sh_right_x)])[0]
    sh_left_y = (
        float(int(h * 0.18) + int(left_col_ys[0]))
        if len(left_col_ys) > 0
        else neck_base_y + h * 0.03
    )
    sh_right_y = (
        float(int(h * 0.18) + int(right_col_ys[0]))
        if len(right_col_ys) > 0
        else neck_base_y + h * 0.03
    )
    mid_sh_y = 0.5 * (sh_left_y + sh_right_y)
    if abs(sh_left_y - sh_right_y) > h * 0.12:
        sh_left_y = neck_base_y + h * 0.03
        sh_right_y = neck_base_y + h * 0.03
        mid_sh_y = sh_left_y

    roll_deg = math.degrees(math.atan2(sh_right_y - sh_left_y, max(1.0, shoulder_width_px)))
    shoulder_mid_x = 0.5 * (sh_left_x + sh_right_x)

    # Head/neck yaw estimated from horizontal offset of chin/neck center relative to shoulder midpoint
    normalized_offset = (chin_x - shoulder_mid_x) / max(1.0, 0.5 * shoulder_width_px)
    yaw_deg = float(np.clip(normalized_offset * 45.0, -45.0, 45.0))

    # Suprasternal notch interpolated between chin and shoulder line
    notch_x = 0.65 * chin_x + 0.35 * shoulder_mid_x
    notch_y = 0.28 * chin_y + 0.72 * mid_sh_y

    # Medial clavicle anchors (+/- 0.18 * shoulder_width_px around notch, foreshortened by yaw)
    clav_half_span = 0.18 * shoulder_width_px
    left_scale = 1.0 - 0.22 * math.sin(math.radians(yaw_deg))
    right_scale = 1.0 + 0.22 * math.sin(math.radians(yaw_deg))

    clav_left_x = notch_x - clav_half_span * left_scale
    clav_right_x = notch_x + clav_half_span * right_scale
    clav_left_y = notch_y - 0.02 * shoulder_width_px + math.tan(math.radians(roll_deg)) * (-clav_half_span)
    clav_right_y = notch_y - 0.02 * shoulder_width_px + math.tan(math.radians(roll_deg)) * clav_half_span

    confidence = float(
        np.clip(
            0.62
            + min(0.18, skin_ratio * 1.4)
            - 0.005 * abs(yaw_deg)
            - 0.005 * abs(roll_deg),
            0.0,
            0.88,
        )
    )

    landmarks = NeckClavicleLandmarks(
        chin_xy=(round(chin_x, 2), round(chin_y, 2)),
        jaw_left_xy=(round(jaw_left_x, 2), round(chin_y - 0.04 * h, 2)),
        jaw_right_xy=(round(jaw_right_x, 2), round(chin_y - 0.04 * h, 2)),
        shoulder_left_xy=(round(sh_left_x, 2), round(sh_left_y, 2)),
        shoulder_right_xy=(round(sh_right_x, 2), round(sh_right_y, 2)),
        suprasternal_notch_xy=(round(notch_x, 2), round(notch_y, 2)),
        clavicle_left_xy=(round(clav_left_x, 2), round(clav_left_y, 2)),
        clavicle_right_xy=(round(clav_right_x, 2), round(clav_right_y, 2)),
        shoulder_width_px=round(shoulder_width_px, 2),
        yaw_deg=round(yaw_deg, 2),
        roll_deg=round(roll_deg, 2),
        confidence=round(confidence, 3),
        detector_backend="heuristic_skin_silhouette_fallback",
        verified_anatomical=False,
    )
    validate_landmarks_plausibility(landmarks, (w, h))
    return landmarks


def segment_jewellery_product(product_img: Image.Image) -> SegmentedJewellery:
    """
    Extract the necklace or pendant foreground RGBA layer and canonical control
    anchors (`anchor_left_xy`, `anchor_right_xy`, `anchor_drop_xy`).

    Raises `VTONValidationError` if the product image is transparent/empty,
    unsegmented full-bleed clutter, has inverted/degenerate anchors, or has an
    unsupported aspect ratio.
    """
    rgba = product_img.convert("RGBA")
    arr = np.asarray(rgba, dtype=np.uint8)
    h, w, _ = arr.shape

    alpha_chan = arr[:, :, 3].astype(np.float32) / 255.0
    has_native_alpha = bool(np.min(alpha_chan) < 0.05 and np.max(alpha_chan) > 0.25)

    if has_native_alpha:
        fg_mask_float = alpha_chan
        method = "native_rgba_alpha"
    else:
        rgb = arr[:, :, :3].astype(np.float32)
        if float(np.std(rgb)) < 3.5:
            raise VTONValidationError(
                "Jewellery segmentation failed: product image is blank or uniform.",
                category="segmentation_failure",
            )
        # Sample border perimeter pixels to estimate studio background color
        b_pad = max(2, min(h, w) // 20)
        border_pixels = np.concatenate(
            [
                rgb[:b_pad, :, :].reshape(-1, 3),
                rgb[h - b_pad :, :, :].reshape(-1, 3),
                rgb[:, :b_pad, :].reshape(-1, 3),
                rgb[:, w - b_pad :, :].reshape(-1, 3),
            ],
            axis=0,
        )
        bg_median = np.median(border_pixels, axis=0)
        bg_std = float(np.mean(np.std(border_pixels, axis=0)))
        if bg_std > 48.0:
            raise VTONValidationError(
                "Jewellery segmentation failed: product background is too cluttered. "
                "Please use an isolated product photo on a white, neutral, or transparent background.",
                category="segmentation_failure",
            )
        dist = np.linalg.norm(rgb - bg_median[None, None, :], axis=2)
        # Soft ramp between threshold 12 and 36 so 1-3px metallic chain links survive segmentation
        fg_mask_float = np.clip((dist - 12.0) / 24.0, 0.0, 1.0)
        method = "border_chroma_key_matte"

    binary_fg = fg_mask_float > 0.12
    fg_ratio = float(np.mean(binary_fg))

    if fg_ratio < 0.0025:
        raise VTONValidationError(
            "Jewellery segmentation failed: product image is empty or completely transparent.",
            category="segmentation_failure",
        )
    if fg_ratio > 0.90:
        raise VTONValidationError(
            "Jewellery segmentation failed: could not isolate necklace from background "
            f"(foreground ratio {fg_ratio:.2f} > 0.90).",
            category="segmentation_failure",
        )

    ys, xs = np.where(binary_fg)
    x_min, x_max = int(np.min(xs)), int(np.max(xs))
    y_min, y_max = int(np.min(ys)), int(np.max(ys))
    crop_w = x_max - x_min + 1
    crop_h = y_max - y_min + 1

    if crop_w < 16 or crop_h < 12:
        raise VTONValidationError(
            f"Segmented jewellery region ({crop_w}x{crop_h}px) is too small.",
            category="segmentation_failure",
        )

    aspect = float(crop_w) / float(max(1, crop_h))
    if aspect < 0.20 or aspect > 5.5:
        raise VTONValidationError(
            f"Unsupported necklace/pendant aspect ratio ({aspect:.2f}).",
            category="unsupported_necklace_type",
        )

    out_rgba = arr.copy()
    out_rgba[:, :, 3] = np.clip(np.round(fg_mask_float * 255.0), 0, 255).astype(np.uint8)
    cropped_rgba = Image.fromarray(out_rgba[y_min : y_max + 1, x_min : x_max + 1, :], mode="RGBA")
    cropped_mask = cropped_rgba.getchannel("A")

    # Canonical product keypoints inside cropped coordinate frame
    crop_fg = binary_fg[y_min : y_max + 1, x_min : x_max + 1]
    upper_band = crop_fg[: max(1, int(crop_h * 0.45)), :]
    up_ys, up_xs = np.where(upper_band)
    if len(up_xs) < 2:
        raise VTONValidationError(
            "Jewellery segmentation failed: could not locate upper left and right chain tangents.",
            category="segmentation_failure",
        )

    q_left = (float(np.percentile(up_xs, 5)), float(np.percentile(up_ys, 15)))
    q_right = (float(np.percentile(up_xs, 95)), float(np.percentile(up_ys, 15)))

    bottom_band = crop_fg[max(0, int(crop_h * 0.65)) :, :]
    b_ys, b_xs = np.where(bottom_band)
    if len(b_xs) >= 1:
        q_drop = (
            float(np.median(b_xs)),
            float(max(0, int(crop_h * 0.65)) + np.max(b_ys)),
        )
    else:
        q_drop = (0.5 * crop_w, float(crop_h - 1))

    # Validate anchor order and numerical stability
    if (
        not math.isfinite(q_left[0])
        or not math.isfinite(q_right[0])
        or not math.isfinite(q_drop[1])
        or q_right[0] - q_left[0] < 0.15 * crop_w
        or q_drop[1] <= min(q_left[1], q_right[1])
    ):
        raise VTONValidationError(
            "Jewellery anchor extraction failed: upper chain anchors are inverted or collapsed.",
            category="segmentation_failure",
        )

    return SegmentedJewellery(
        rgba_crop=cropped_rgba,
        alpha_mask=cropped_mask,
        bbox=(x_min, y_min, x_max + 1, y_max + 1),
        foreground_ratio=round(fg_ratio, 4),
        aspect_ratio=round(aspect, 3),
        anchor_left_xy=(round(q_left[0], 2), round(q_left[1], 2)),
        anchor_right_xy=(round(q_right[0], 2), round(q_right[1], 2)),
        anchor_drop_xy=(round(q_drop[0], 2), round(q_drop[1], 2)),
        segmentation_method=method,
    )


def warp_and_place_necklace(
    person_size: tuple[int, int],
    segmented: SegmentedJewellery,
    landmarks: NeckClavicleLandmarks,
    subcategory: str,
) -> tuple[Image.Image, tuple[int, int, int, int], dict[str, Any]]:
    """
    Scale, perspective-adjust, and catenary-warp the segmented necklace/pendant
    onto a full-canvas RGBA layer aligned with the person's clavicle landmarks.
    Preserves thin 1-3px chain links during downscaling.
    """
    validate_landmarks_plausibility(landmarks, person_size)

    pw, ph = person_size
    clav_lx, clav_ly = landmarks.clavicle_left_xy
    clav_rx, clav_ry = landmarks.clavicle_right_xy
    notch_x, _ = landmarks.suprasternal_notch_xy

    clav_span = clav_rx - clav_lx
    if clav_span < 20.0 or not math.isfinite(clav_span):
        raise VTONProviderError(
            "Clavicle anchor span is invalid or inverted.",
            category="warp_failure",
        )

    scale_factor = 1.15 if subcategory == "NECKLACE" else 1.08
    target_w = int(round(clav_span * scale_factor))
    target_h = max(16, int(round(target_w / max(0.25, segmented.aspect_ratio))))
    target_h = min(target_h, int(round(ph * 0.32)))

    if target_w <= 8 or target_h <= 8 or target_w >= pw or target_h >= ph:
        raise VTONProviderError(
            f"Numerically unstable or out-of-bounds necklace target size ({target_w}x{target_h}px).",
            category="warp_failure",
        )

    # Preserve thin 1-3px chain alpha when downscaling from higher-resolution product images
    crop_rgba = segmented.rgba_crop
    if target_w < crop_rgba.width or target_h < crop_rgba.height:
        r_ch, g_ch, b_ch, a_ch = crop_rgba.split()
        dilated_a = a_ch.filter(ImageFilter.MaxFilter(3))
        preserved_a = Image.blend(a_ch, dilated_a, alpha=0.55)
        crop_rgba = Image.merge("RGBA", (r_ch, g_ch, b_ch, preserved_a))

    resized_rgba = crop_rgba.resize((target_w, target_h), Image.Resampling.LANCZOS)
    src_arr = np.asarray(resized_rgba, dtype=np.uint8)

    # Apply parabolic catenary sag along columns so flat product photos conform to 3D neck curve
    sag_amplitude_px = max(2.0, min(14.0, 0.08 * target_h))
    warped_h = target_h + int(math.ceil(sag_amplitude_px)) + 4
    warped_arr = np.zeros((warped_h, target_w, 4), dtype=np.uint8)

    xs = np.linspace(-1.0, 1.0, target_w)
    yaw_rad = math.radians(landmarks.yaw_deg)
    sag_profile = sag_amplitude_px * (1.0 - xs**2) * (1.0 + 0.12 * math.sin(yaw_rad) * xs)

    for col in range(target_w):
        dy = int(round(float(sag_profile[col])))
        dy = max(0, min(warped_h - target_h, dy))
        warped_arr[dy : dy + target_h, col, :] = src_arr[:, col, :]

    warped_rgba = Image.fromarray(warped_arr, mode="RGBA")

    # Rotate slightly to match shoulder roll, keeping pendant gravity-damped (50% roll damping)
    effective_roll = -0.5 * landmarks.roll_deg
    if abs(effective_roll) >= 0.4:
        warped_rgba = warped_rgba.rotate(
            effective_roll,
            resample=Image.Resampling.BICUBIC,
            expand=True,
        )

    ww, wh = warped_rgba.size
    paste_x = int(round(notch_x - ww * 0.5))
    paste_y = int(round(min(clav_ly, clav_ry) - wh * 0.14))

    # Never allow placement box to intrude above the jawline into the face
    min_allowed_y = max(0, int(round(landmarks.chin_xy[1] - 0.03 * ph)))
    paste_y = max(min_allowed_y, paste_y)

    if paste_x < 0 or paste_y < 0 or paste_x + ww > pw or paste_y + wh > ph:
        paste_x = max(0, min(pw - ww, paste_x))
        paste_y = max(min_allowed_y, min(ph - wh, paste_y))

    canvas_rgba = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    canvas_rgba.paste(warped_rgba, (paste_x, paste_y), warped_rgba)

    roi_box = (paste_x, paste_y, min(pw, paste_x + ww), min(ph, paste_y + wh))
    if roi_box[2] <= roi_box[0] or roi_box[3] <= roi_box[1]:
        raise VTONProviderError(
            f"Invalid necklace placement ROI {roi_box}.",
            category="warp_failure",
        )

    warp_meta = {
        "target_width_px": ww,
        "target_height_px": wh,
        "catenary_sag_px": round(sag_amplitude_px, 2),
        "applied_roll_deg": round(effective_roll, 2),
        "placement_box": list(roi_box),
    }
    return canvas_rgba, roi_box, warp_meta


def estimate_foreground_occlusion_mask(
    person_rgb: Image.Image,
    landmarks: NeckClavicleLandmarks,
    roi_box: tuple[int, int, int, int],
) -> Image.Image:
    """
    Estimate foreground occluders (chin contour, hair strands overlapping the
    outer clavicle, and shirt collar lapels) within `roi_box`.

    Returns a single-channel `L` mask (`255` = foreground occluder in front of necklace,
    `0` = bare skin / background behind necklace).
    """
    pw, ph = person_rgb.size
    occ_arr = np.zeros((ph, pw), dtype=np.uint8)
    rgb_arr = np.asarray(person_rgb.convert("RGB"), dtype=np.uint8)
    skin_mask = _compute_skin_mask(rgb_arr)

    # 1. Chin & face protection: strictly mask out any pixels above the chin contour
    chin_x, chin_y = landmarks.chin_xy
    jaw_span = max(24.0, landmarks.jaw_right_xy[0] - landmarks.jaw_left_xy[0])
    x0, y0, x1, y1 = roi_box

    # Protect all rows above the jaw/chin line across the ROI
    upper_face_limit = max(0, int(round(chin_y - 0.03 * ph)))
    if upper_face_limit > y0:
        occ_arr[y0 : min(y1, upper_face_limit), max(0, x0) : min(pw, x1)] = 255

    for x in range(max(0, x0), min(pw, x1)):
        norm_dx = (x - chin_x) / (0.55 * jaw_span)
        if abs(norm_dx) <= 1.0:
            chin_curve_y = int(round(chin_y - (norm_dx**2) * (0.03 * ph)))
            if chin_curve_y > y0:
                occ_arr[y0 : min(y1, chin_curve_y), x] = 255

    # 2. Lateral hair / collar lapel occlusion on outer 20% of clavicle ROI
    roi_w = max(1, x1 - x0)
    lateral_margin = int(round(0.20 * roi_w))
    luma = (
        0.299 * rgb_arr[:, :, 0]
        + 0.587 * rgb_arr[:, :, 1]
        + 0.114 * rgb_arr[:, :, 2]
    )
    non_skin_occluder = (~skin_mask) & ((luma < 50.0) | (luma > 220.0))

    left_zone_end = min(pw, x0 + lateral_margin)
    right_zone_start = max(0, x1 - lateral_margin)
    if left_zone_end > x0:
        occ_arr[y0:y1, x0:left_zone_end] = np.where(
            non_skin_occluder[y0:y1, x0:left_zone_end],
            210,
            occ_arr[y0:y1, x0:left_zone_end],
        )
    if x1 > right_zone_start:
        occ_arr[y0:y1, right_zone_start:x1] = np.where(
            non_skin_occluder[y0:y1, right_zone_start:x1],
            210,
            occ_arr[y0:y1, right_zone_start:x1],
        )

    occ_img = Image.fromarray(occ_arr, mode="L").filter(ImageFilter.GaussianBlur(radius=1.5))
    return occ_img


def composite_necklace_onto_person(
    person_rgb: Image.Image,
    warped_necklace_rgba: Image.Image,
    occlusion_mask_l: Image.Image,
    roi_box: tuple[int, int, int, int],
) -> tuple[Image.Image, Image.Image]:
    """
    Composite the warped necklace onto `person_rgb` with foreground occlusion
    handling, directional contact shadow, and subtle local luminance matching.

    Guarantees 100% pixel identity outside `roi_box` and verifies that foreground
    occlusion does not erase the necklace.
    """
    base_arr = np.asarray(person_rgb.convert("RGB"), dtype=np.float32)
    neck_arr = np.asarray(warped_necklace_rgba.convert("RGBA"), dtype=np.float32)
    occ_arr = np.asarray(occlusion_mask_l, dtype=np.float32) / 255.0

    raw_alpha = neck_arr[:, :, 3] / 255.0
    raw_alpha_sum = float(np.sum(raw_alpha))
    if raw_alpha_sum < 10.0:
        raise VTONProviderError(
            "Warped necklace alpha layer is empty prior to compositing.",
            category="compositing_failure",
        )

    eff_alpha = raw_alpha * (1.0 - 0.85 * occ_arr)
    visible_retention = float(np.sum(eff_alpha)) / raw_alpha_sum
    if visible_retention < MIN_VISIBLE_ALPHA_RETENTION:
        raise VTONValidationError(
            f"Neck/clavicle region is overly occluded (only {visible_retention * 100:.0f}% of necklace "
            f"remains visible; minimum {MIN_VISIBLE_ALPHA_RETENTION * 100:.0f}%).",
            category="excessive_occlusion",
        )

    eff_alpha_u8 = np.clip(np.round(eff_alpha * 255.0), 0, 255).astype(np.uint8)
    eff_mask_img = Image.fromarray(eff_alpha_u8, mode="L")

    # Contact shadow shifted (0, +2px) and blurred
    shadow_img = Image.new("L", person_rgb.size, 0)
    shadow_img.paste(eff_mask_img, (0, 2))
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(radius=2.5))
    shadow_alpha = (np.asarray(shadow_img, dtype=np.float32) / 255.0) * 0.22 * (1.0 - eff_alpha)

    # Subtle exposure harmonization inside ROI (+/- 8% max)
    x0, y0, x1, y1 = roi_box
    roi_person_luma = float(np.mean(base_arr[y0:y1, x0:x1, :])) if (x1 > x0 and y1 > y0) else 140.0
    luma_gain = float(np.clip(0.92 + 0.16 * (roi_person_luma / 255.0), 0.92, 1.08))
    jewellery_rgb = np.clip(neck_arr[:, :, :3] * luma_gain, 0.0, 255.0)

    shadowed_base = base_arr * (1.0 - shadow_alpha[:, :, None])
    comp_arr = shadowed_base * (1.0 - eff_alpha[:, :, None]) + jewellery_rgb * eff_alpha[:, :, None]

    # Strictly preserve 100% of original pixels outside roi_box
    final_arr = base_arr.copy()
    final_arr[y0:y1, x0:x1, :] = comp_arr[y0:y1, x0:x1, :]
    final_img = Image.fromarray(np.clip(np.round(final_arr), 0, 255).astype(np.uint8), mode="RGB")
    return final_img, eff_mask_img


class NecklacePocProvider(VTONProvider):
    """
    Experimental Proof-of-Concept (`landmark_jewellery_neck`) processor for
    `NECKLACE` and `PENDANT` virtual try-on.

    Gated behind `ENABLE_NECKLACE_POC=true` (`enable_necklace_poc=True`).
    Never routes through `yisol/IDM-VTON`, FASHN clothing inference, or `MockProvider`.
    """

    VERSION = "necklace-poc-v0.1.0-experimental"

    def __init__(
        self,
        enabled: bool = False,
        timeout_seconds: float = 30.0,
        landmark_detector: Callable[[Image.Image], NeckClavicleLandmarks] | None = None,
        require_mediapipe: bool = False,
    ) -> None:
        self._enabled = enabled
        self._timeout_seconds = timeout_seconds
        self._landmark_detector = landmark_detector or detect_neck_clavicle_landmarks
        self._require_mediapipe = require_mediapipe

    @property
    def name(self) -> str:
        return "necklace-poc"

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
        subcategory: str | None = None,
        debug_artifact_dir: Path | str | None = None,
    ) -> tuple[bytes, str, dict[str, Any]]:
        start_ms = int(time.time() * 1000)

        if not self._enabled:
            raise VTONConfigError(
                "Necklace/Pendant PoC processor ('landmark_jewellery_neck') is disabled. "
                "Set ENABLE_NECKLACE_POC=true to enable experimental necklace/pendant try-on."
            )

        if self._require_mediapipe:
            try:
                import mediapipe  # type: ignore # noqa: F401
            except ImportError as exc:
                raise VTONConfigError(
                    "Required MediaPipe landmark model/dependency ('mediapipe') is not installed "
                    "in the active Python environment."
                ) from exc

        norm_subcat = (subcategory or category).strip().upper()
        if norm_subcat not in SUPPORTED_NECKLACE_SUBCATEGORIES:
            raise VTONValidationError(
                f"NecklacePocProvider only supports {sorted(SUPPORTED_NECKLACE_SUBCATEGORIES)}, "
                f"got '{norm_subcat}'.",
                category="unsupported_category_for_provider",
            )

        # Stage 1 & 2: Validate person and jewellery product images + EXIF normalization
        try:
            p_info = validate_and_encode_image(person_image_bytes, "person_image")
            g_info = validate_and_encode_image(garment_image_bytes, "garment_image")
        except ImageValidationError as exc:
            raise VTONValidationError(str(exc), category="malformed_input") from exc

        try:
            with Image.open(io.BytesIO(person_image_bytes)) as raw_p:
                person_loaded = ImageOps.exif_transpose(raw_p)
                if person_loaded.mode == "RGBA":
                    p_alpha = np.asarray(person_loaded.getchannel("A"), dtype=np.float32) / 255.0
                    if float(np.mean(p_alpha > 0.1)) < 0.50:
                        raise VTONValidationError(
                            "Person image is predominantly transparent and cannot be used for try-on.",
                            category="malformed_input",
                        )
                person_rgb = person_loaded.convert("RGB")
                orig_size = person_rgb.size

            with Image.open(io.BytesIO(garment_image_bytes)) as raw_g:
                product_img = ImageOps.exif_transpose(raw_g)
                product_img.load()
        except VTONError:
            raise
        except Exception as exc:
            raise VTONValidationError(
                f"Failed to decode input images: {exc}",
                category="malformed_input",
            ) from exc

        # Stage 3: Estimate neck, chin, shoulder, and clavicle landmarks + validate plausibility
        landmarks = self._landmark_detector(person_rgb)
        validate_landmarks_plausibility(landmarks, orig_size)

        # Stage 4 & 5: Segment jewellery product and validate extracted anchors
        segmented = segment_jewellery_product(product_img)

        # Stage 6 & 7: Perspective scaling and catenary warping to clavicle curve
        warped_rgba, roi_box, warp_meta = warp_and_place_necklace(
            person_size=orig_size,
            segmented=segmented,
            landmarks=landmarks,
            subcategory=norm_subcat,
        )

        # Stage 8: Foreground occlusion estimation (chin, hair strands, collar lapels)
        try:
            occlusion_mask = estimate_foreground_occlusion_mask(
                person_rgb=person_rgb,
                landmarks=landmarks,
                roi_box=roi_box,
            )
            if occlusion_mask.size != orig_size:
                raise ValueError("Occlusion mask dimensions do not match person image.")
        except VTONError:
            raise
        except Exception as exc:
            raise VTONProviderError(
                f"Occlusion estimation failed: {exc}",
                category="occlusion_failure",
            ) from exc

        # Stage 9: Depth-ordered compositing with contact shadow
        final_rgb, eff_mask = composite_necklace_onto_person(
            person_rgb=person_rgb,
            warped_necklace_rgba=warped_rgba,
            occlusion_mask_l=occlusion_mask,
            roi_box=roi_box,
        )

        # Stage 10: Validate generated image (dimensions, color mode, ROI invariant, decodability)
        elapsed_sec = (int(time.time() * 1000) - start_ms) / 1000.0
        if elapsed_sec > self._timeout_seconds:
            raise VTONTimeoutError(
                f"Necklace PoC processing exceeded timeout of {self._timeout_seconds:.1f}s."
            )

        if final_rgb.size != orig_size or final_rgb.mode != "RGB":
            raise VTONProviderError(
                "Generated composite dimensions or color mode do not match original person image.",
                category="compositing_failure",
            )

        orig_arr_u8 = np.asarray(person_rgb, dtype=np.uint8)
        comp_arr_u8 = np.asarray(final_rgb, dtype=np.uint8)
        x0, y0, x1, y1 = roi_box

        outside_mask = np.ones(orig_arr_u8.shape[:2], dtype=bool)
        outside_mask[y0:y1, x0:x1] = False
        if not np.array_equal(orig_arr_u8[outside_mask], comp_arr_u8[outside_mask]):
            raise VTONProviderError(
                "ROI invariant violation: pixels outside neck/clavicle placement box were modified.",
                category="compositing_failure",
            )

        roi_diff = float(
            np.mean(
                np.abs(
                    comp_arr_u8[y0:y1, x0:x1, :].astype(np.float32)
                    - orig_arr_u8[y0:y1, x0:x1, :].astype(np.float32)
                )
            )
        )
        if roi_diff < 0.25:
            raise VTONProviderError(
                "Necklace compositing produced no visible change in the target neck/clavicle region.",
                category="compositing_failure",
            )

        out_buf = io.BytesIO()
        final_rgb.save(out_buf, format="JPEG", quality=94)
        out_bytes = out_buf.getvalue()
        if not out_bytes:
            raise VTONProviderError("Encoded output image is empty.", category="compositing_failure")

        # Verify encoded output is valid and decodable
        with Image.open(io.BytesIO(out_bytes)) as check_out:
            check_out.verify()

        debug_artifacts: dict[str, str] = {}
        if debug_artifact_dir is not None:
            dbg_dir = Path(debug_artifact_dir).resolve()
            dbg_dir.mkdir(parents=True, exist_ok=True)
            ext_map = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
            p_ext = ext_map.get(p_info.format_name.upper(), "jpg")
            g_ext = ext_map.get(g_info.format_name.upper(), "png")

            p_orig_file = dbg_dir / f"01_person_orig.{p_ext}"
            g_orig_file = dbg_dir / f"02_product_orig.{g_ext}"
            landmarks_file = dbg_dir / "03_person_preprocessed.png"
            raw_layer_file = dbg_dir / "04_provider_raw_output.png"
            mask_file = dbg_dir / "05_provider_mask.png"
            final_file = dbg_dir / "06_final_composited.jpg"

            p_orig_file.write_bytes(person_image_bytes)
            g_orig_file.write_bytes(garment_image_bytes)

            # Save diagnostic landmark visualization on person copy
            lm_vis = person_rgb.copy()
            draw = ImageDraw.Draw(lm_vis)
            draw.rectangle(list(roi_box), outline=(168, 85, 247), width=2)
            for pt in (
                landmarks.chin_xy,
                landmarks.suprasternal_notch_xy,
                landmarks.clavicle_left_xy,
                landmarks.clavicle_right_xy,
                landmarks.shoulder_left_xy,
                landmarks.shoulder_right_xy,
            ):
                px, py = int(round(pt[0])), int(round(pt[1]))
                draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(16, 185, 129))
            lm_vis.save(landmarks_file, format="PNG")

            # Raw unoccluded placement preview
            raw_preview = person_rgb.copy().convert("RGBA")
            raw_preview.alpha_composite(warped_rgba)
            raw_preview.convert("RGB").save(raw_layer_file, format="PNG")

            eff_mask.save(mask_file, format="PNG")
            final_file.write_bytes(out_bytes)

            debug_artifacts = {
                "person_orig": str(p_orig_file),
                "garment_orig": str(g_orig_file),
                "person_preprocessed": str(landmarks_file),
                "provider_raw_output": str(raw_layer_file),
                "provider_mask": str(mask_file),
                "final_composited": str(final_file),
            }

        elapsed_ms = int(time.time() * 1000) - start_ms
        metadata: dict[str, Any] = {
            "provider": self.name,
            "processor_version": self.VERSION,
            "routing_strategy": "landmark_jewellery_neck",
            "subcategory": norm_subcat,
            "target_body_region": "neck_clavicle",
            "is_mock": False,
            "is_experimental_poc": True,
            "live_validation_status": "experimental_poc_local_unverified_live",
            "landmark_detection_verified": landmarks.verified_anatomical,
            "elapsed_ms": elapsed_ms,
            "credits_used": "0",
            "landmarks": asdict(landmarks),
            "segmentation": {
                "method": segmented.segmentation_method,
                "foreground_ratio": segmented.foreground_ratio,
                "aspect_ratio": segmented.aspect_ratio,
                "bbox": list(segmented.bbox),
            },
            "warp": warp_meta,
            "roi_mean_abs_diff": round(roi_diff, 3),
        }
        if not landmarks.verified_anatomical:
            metadata["landmark_detector_warning"] = (
                "Heuristic skin/silhouette contour estimator used (MediaPipe not installed); "
                "not equivalent to verified anatomical landmark detection."
            )
        if debug_artifacts:
            metadata["debug_artifacts"] = debug_artifacts

        return out_bytes, "image/jpeg", metadata

    async def health_check(self) -> bool:
        return self._enabled
