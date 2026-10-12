#!/usr/bin/env python3
"""
WearMe — Category-Aware Multi-Wearable Virtual Try-On Benchmark Harness (v2.0)

Supports:
1. 24-case Upper-Body Clothing Benchmark (`scripts/eval_manifest.example.json`)
2. 120-case Multi-Category Wearable Benchmark (`scripts/eval_manifest.v2.example.json`):
   - 24 Clothing cases (T-shirts, shirts, sweaters, hoodies, jackets, tops, dresses,
     trousers, skirts, ethnic wear, sarees)
   - 20 Jewellery cases (necklaces, chains, pendants, earrings, rings, bracelets, bangles)
   - 14 Eyewear cases (prescription glasses, sunglasses)
   - 12 Wristwear cases (watches, smartwatches)
   - 12 Bags cases (handbags, shoulder bags, backpacks)
   - 16 Footwear cases (sneakers, formal shoes, boots, heels, sandals)
   - 12 Headwear & hair accessory cases (hats, caps, headbands, hair clips, occasion headwear)
   - 10 Other accessory cases (belts, scarves, ties)

Key Safeguards:
- Incomplete dataset protection: Template manifests without real images are explicitly
  marked `dataset_status="template_incomplete_images"` and `image_readiness="missing_images"`.
- Permission enforcement: Refuses to load any image unless `consent_verified=True` and
  `permission_source` + `license_url`/`attribution` are populated.
- Category-aware routing via `CategoryRouterProvider`: Never forces non-upper-body items
  through `yisol/IDM-VTON` (`/tryon`) and never silently falls back to `MockProvider`.
- Preserves original inputs, raw provider output (`04_provider_raw_output`), provider mask
  (`05_provider_mask`), final post-processed output (`06_final_composited`), and a labeled
  side-by-side contact sheet (`07_comparison_strip.jpg`).
- Uses a 5-dimension 1–5 human scoring rubric (Product Fidelity, Placement & Fit,
  Identity/Anatomy Preservation, Occlusion & Realism, Robustness across Lighting/Pose/Quality),
  initialized to `None` placeholders so subjective scores are never fabricated automatically.
"""

import argparse
import asyncio
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time
from typing import Any
from PIL import Image, ImageDraw

# Allow importing from apps/ai
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "apps" / "ai"))

from app.services.base import VTONError, VTONProvider  # noqa: E402
from app.services.category_router import CategoryRouterProvider  # noqa: E402
from app.services.fashn_api_provider import FASHNApiProvider  # noqa: E402
from app.services.huggingface_provider import HuggingFaceProvider  # noqa: E402
from app.services.mock_provider import MockProvider  # noqa: E402
from app.services.necklace_poc_provider import NecklacePocProvider  # noqa: E402
from app.services.wearable_taxonomy import resolve_wearable_spec  # noqa: E402


@dataclass
class EvalCase:
    case_id: str
    title: str
    category: str
    person_condition: str
    garment_condition: str
    subcategory: str | None = None
    domain: str = "clothing"
    stress_group: str = "general"
    target_body_region: str = "upper_body_torso"
    required_landmarks: list[str] = field(default_factory=list)
    expected_routing_strategy: str = "diffusion_upper_body"
    garment_photo_type: str = "flat-lay"
    person_image_path: str | None = None
    garment_image_path: str | None = None
    product_image_path: str | None = None
    image_readiness: str = "missing_images"
    permission_source: str | None = "user_consented_own_photo"
    license_url: str | None = "https://creativecommons.org/publicdomain/zero/1.0/"
    attribution: str | None = "Owner-consented evaluation asset / CC0 reference"
    consent_verified: bool = True

    @property
    def effective_product_path(self) -> str | None:
        return self.product_image_path or self.garment_image_path

    @property
    def effective_subcategory(self) -> str:
        return (self.subcategory or self.category).strip().upper()

    def compute_missing_inputs(self) -> list[str]:
        """Return a list of missing image/permission inputs for this evaluation case."""
        missing: list[str] = []
        if not self.person_image_path or not Path(self.person_image_path).is_file():
            missing.append("person_image_path")
        prod = self.effective_product_path
        if not prod or not Path(prod).is_file():
            missing.append("product_image_path")
        if not (self.permission_source or "").strip():
            missing.append("permission_source")
        if not (self.license_url or "").strip():
            missing.append("license_url")
        if not (self.attribution or "").strip():
            missing.append("attribution")
        if not self.consent_verified:
            missing.append("consent_verified")
        return missing


@dataclass
class HumanRubricScores:
    """
    Category-specific 1–5 human evaluation scores (Phase 4).
    Also preserves v1 keys for backwards compatibility with existing clothing reports.
    All fields default to None so automated runs never fabricate subjective scores.
    """

    # Phase 4 5-dimension category-aware rubric
    product_fidelity_1_to_5: int | None = None
    placement_and_fit_1_to_5: int | None = None
    identity_and_anatomy_preservation_1_to_5: int | None = None
    occlusion_and_realism_1_to_5: int | None = None
    lighting_pose_and_quality_robustness_1_to_5: int | None = None
    # Backwards-compatible v1 rubric aliases
    garment_fidelity_1_to_5: int | None = None
    identity_preservation_1_to_5: int | None = None
    fit_fabric_realism_1_to_5: int | None = None
    visual_artifacts_1_to_5: int | None = None
    raw_vs_composited_defect_notes: str = ""
    evaluator_notes: str = ""


@dataclass
class EvalResult:
    run_id: str
    timestamp_utc: str
    case_id: str
    title: str
    domain: str
    category: str
    subcategory: str
    stress_group: str
    target_body_region: str
    required_landmarks: list[str]
    routing_strategy: str
    live_validation_status: str
    adapter_name: str
    provider: str
    model_version: str
    provider_settings: dict[str, Any]
    image_readiness: str
    permission_source: str | None
    license_url: str | None
    consent_verified: bool
    person_sha256: str | None
    person_dimensions: str | None
    garment_sha256: str | None
    garment_dimensions: str | None
    status: str
    duration_ms: int
    provider_inference_ms: int | None
    prediction_id: str | None
    credits_used: str
    estimated_cost_usd: float
    person_orig_path: str | None
    garment_orig_path: str | None
    preprocessed_person_path: str | None
    raw_output_path: str | None
    raw_unpadded_path: str | None
    mask_output_path: str | None
    output_path: str | None
    comparison_strip_path: str | None
    error_category: str | None
    error_message: str | None
    provider_support_status: str = "supported"
    missing_inputs: list[str] = field(default_factory=list)
    raw_output_sha256: str | None = None
    output_sha256: str | None = None
    final_output_path: str | None = None
    human_rubric_scores: dict[str, Any] = field(
        default_factory=lambda: asdict(HumanRubricScores())
    )


def _load_default_24_cases() -> list[EvalCase]:
    manifest_file = Path(__file__).resolve().parent / "eval_manifest.example.json"
    if manifest_file.is_file():
        raw_items = json.loads(manifest_file.read_text(encoding="utf-8"))
        cases: list[EvalCase] = []
        for item in raw_items:
            spec = resolve_wearable_spec(item.get("category", "TSHIRT"), item.get("subcategory"))
            cases.append(
                EvalCase(
                    case_id=item["case_id"],
                    title=item["title"],
                    category=item["category"],
                    subcategory=item.get("subcategory") or item["category"],
                    domain=spec.domain if spec else "clothing",
                    stress_group=item.get("stress_group", "general"),
                    target_body_region=spec.target_body_region if spec else "upper_body_torso",
                    required_landmarks=list(spec.required_landmarks) if spec else [],
                    expected_routing_strategy=spec.routing_strategy if spec else "diffusion_upper_body",
                    person_condition=item["person_condition"],
                    garment_condition=item["garment_condition"],
                    garment_photo_type=item.get("garment_photo_type", "flat-lay"),
                    person_image_path=item.get("person_image_path"),
                    garment_image_path=item.get("garment_image_path"),
                    product_image_path=item.get("product_image_path"),
                    image_readiness="ready"
                    if (item.get("person_image_path") and (item.get("product_image_path") or item.get("garment_image_path")))
                    else "missing_images",
                    permission_source=item.get("permission_source", "user_consented_own_photo"),
                    license_url=item.get("license_url", "https://creativecommons.org/publicdomain/zero/1.0/"),
                    attribution=item.get("attribution", "Owner-consented evaluation asset / CC0 reference"),
                    consent_verified=bool(item.get("consent_verified", True)),
                )
            )
        return cases
    raise FileNotFoundError(f"Default manifest not found at {manifest_file}")


DEFAULT_24_CASES: list[EvalCase] = _load_default_24_cases()
DEFAULT_15_CASES: list[EvalCase] = DEFAULT_24_CASES[:15]


# ─── 120-Case Multi-Category Wearable Benchmark Specification (Phase 2) ──────
# Allocation:
# - Clothing: 24 cases (TC-001 .. TC-024) covering T-shirts, shirts, sweaters, hoodies,
#   jackets, tops, dresses, trousers, skirts, ethnic wear, and sarees.
# - Jewellery: 20 cases (TC-025 .. TC-044)
# - Eyewear: 14 cases (TC-045 .. TC-058)
# - Wristwear: 12 cases (TC-059 .. TC-070)
# - Bags: 12 cases (TC-071 .. TC-082)
# - Footwear: 16 cases (TC-083 .. TC-098)
# - Headwear & hair accessories: 12 cases (TC-099 .. TC-110)
# - Other accessories (belts, scarves, ties): 10 cases (TC-111 .. TC-120)
_V2_BLUEPRINT: list[tuple[str, str, int, str, str, str]] = [
    # (category, subcategory, count, stress_group, person_condition, product_condition)
    # 1. Clothing (24 cases: TC-001..TC-024)
    ("CLOTHING", "TSHIRT", 3, "upper_body_baseline", "Front-facing torso portrait, neutral lighting", "Flat-lay crewneck/graphic cotton t-shirt"),
    ("CLOTHING", "SHIRT", 3, "upper_body_tailored", "Front-facing portrait, arms relaxed", "Flat-lay button-down dress/plaid shirt with collar"),
    ("CLOTHING", "SWEATER", 2, "upper_body_knitwear", "Indoor portrait, neutral stance", "Chunky cable-knit / merino crewneck sweater"),
    ("CLOTHING", "HOODIE", 2, "upper_body_outerwear", "Casual smartphone torso photo", "Pullover fleece hoodie with hood and kangaroo pocket"),
    ("CLOTHING", "JACKET", 2, "upper_body_outerwear", "Front-facing upper-body photo", "Structured zip-up denim / bomber jacket"),
    ("CLOTHING", "TOP", 2, "upper_body_drape", "Front-facing portrait, visible collarbone", "Sleeveless / V-neck draped blouse top"),
    ("CLOTHING", "DRESS", 2, "full_body_one_piece", "Full-body standing portrait", "Midi / A-line one-piece dress"),
    ("CLOTHING", "TROUSERS", 2, "lower_body_fit", "Full-body standing photo showing waist to ankles", "Tailored chinos / straight-leg denim trousers"),
    ("CLOTHING", "SKIRT", 2, "lower_body_drape", "Full-body standing photo showing waist to calves", "Pleated midi / A-line skirt"),
    ("CLOTHING", "ETHNIC_WEAR", 2, "ethnic_kurti_suit", "Full-body front-facing portrait", "Embroidered kurti / salwar kameez set"),
    ("CLOTHING", "SAREE", 2, "ethnic_saree_drape", "Full-body standing portrait", "Traditional silk/georgette saree with pallu border"),
    # 2. Jewellery (20 cases: TC-025..TC-044)
    ("JEWELLERY", "NECKLACE", 4, "clavicle_curve_fit", "Close portrait with open scoop/V neckline", "Collarbone statement / choker necklace on clean background"),
    ("JEWELLERY", "CHAIN", 3, "thin_metallic_detail", "Portrait with bare neck and neutral lighting", "Fine gold/silver link chain (tests 1-3px width preservation)"),
    ("JEWELLERY", "PENDANT", 3, "central_drop_alignment", "Front-facing portrait with visible sternum/clavicle", "Chain with central gemstone/medallion pendant"),
    ("JEWELLERY", "EARRINGS", 4, "earlobe_and_hair_occlusion", "Portrait at 0-degree and 20-degree head yaw, earlobes visible", "Stud and drop/chandelier earrings"),
    ("JEWELLERY", "RING", 3, "finger_phalanx_orientation", "Clear hand/finger closeup or hand resting near chest", "Solitaire / band ring on transparent/white background"),
    ("JEWELLERY", "BRACELET", 2, "wrist_contour_fit", "Visible bare wrist and forearm", "Chain / tennis bracelet"),
    ("JEWELLERY", "BANGLE", 1, "rigid_wrist_loop", "Visible bare wrist in 3/4 pose", "Rigid gold/enamel bangle"),
    # 3. Eyewear (14 cases: TC-045..TC-058)
    ("EYEWEAR", "PRESCRIPTION_GLASSES", 7, "optical_frame_and_bridge", "Clear face portrait (0, 15, and 25 degree yaw)", "Wire-rim, rimless, and tortoise-acetate optical frames"),
    ("EYEWEAR", "SUNGLASSES", 7, "tinted_lens_and_reflection", "Outdoor and indoor face portraits", "Aviator, wayfarer, cat-eye, and oversized polarized sunglasses"),
    # 4. Wristwear (12 cases: TC-059..TC-070)
    ("WRISTWEAR", "WATCH", 6, "watch_dial_and_strap", "Visible dorsal wrist (relaxed arm and hand-on-hip)", "Analog chronograph and dress watches with leather/metal straps"),
    ("WRISTWEAR", "SMARTWATCH", 6, "smartwatch_case_and_cuff", "Visible wrist (bare arm and near long-sleeve cuff)", "Rectangular and circular smartwatches with silicone/mesh bands"),
    # 5. Bags (12 cases: TC-071..TC-082)
    ("BAGS", "HANDBAG", 4, "hand_handle_occlusion", "Three-quarter body shot with visible hand/wrist", "Structured leather tote / top-handle handbag"),
    ("BAGS", "SHOULDER_BAG", 4, "shoulder_strap_and_arm_overlap", "Upper-to-mid body shot, relaxed shoulder and arm", "Shoulder bag and crossbody bag with long strap"),
    ("BAGS", "BACKPACK", 4, "dual_shoulder_strap_occlusion", "Front and 45-degree torso stance", "Everyday / travel backpack showing shoulder straps"),
    # 6. Footwear (16 cases: TC-083..TC-098)
    ("FOOTWEAR", "SNEAKERS", 4, "ankle_and_sole_perspective", "Full-body standing photo with visible ankles and feet", "Low-top and high-top athletic sneakers"),
    ("FOOTWEAR", "FORMAL_SHOES", 3, "trouser_hem_occlusion", "Full-body standing photo in tailored trousers", "Leather oxford / derby dress shoes"),
    ("FOOTWEAR", "BOOTS", 3, "shaft_to_calf_transition", "Full-body photo in cuffed jeans or shorts", "Chelsea / lace-up ankle and mid-calf boots"),
    ("FOOTWEAR", "HEELS", 3, "arch_and_heel_geometry", "Full-body standing photo with visible feet", "Stiletto pumps and block-heel shoes"),
    ("FOOTWEAR", "SANDALS", 3, "open_toe_skin_preservation", "Full-body standing photo with bare feet/sandals", "Open-toe strappy flat sandals and slides"),
    # 7. Headwear & Hair Accessories (12 cases: TC-099..TC-110)
    ("HEADWEAR", "HAT", 3, "crown_and_brim_hair_layering", "Head-and-shoulders portrait with varied hairstyles", "Wide-brim fedora, sun hat, and bucket hat"),
    ("HEADWEAR", "CAP", 3, "forehead_visor_alignment", "Front and 3/4 face portrait", "Structured baseball cap / dad hat"),
    ("HEADWEAR", "HEADBAND", 2, "hairline_arc_occlusion", "Face portrait with hair down or tied back", "Padded / embellished headband"),
    ("HEADWEAR", "HAIR_CLIP", 2, "side_hair_anchor", "3/4 head portrait showing side hair", "Pearl / metallic hair barrettes and claw clips"),
    ("HEADWEAR", "OCCASION_HEADWEAR", 2, "crown_tiara_placement", "Formal front-facing portrait", "Bridal tiara / floral occasion headpiece"),
    # 8. Other Accessories (10 cases: TC-111..TC-120)
    ("ACCESSORIES", "BELT", 4, "waistline_loop_alignment", "Mid-body shot showing trouser/skirt waistband", "Leather belt with metallic buckle"),
    ("ACCESSORIES", "SCARF", 3, "neck_drape_and_collar_overlap", "Upper-body portrait in coat or crewneck", "Cashmere / silk neck scarf"),
    ("ACCESSORIES", "TIE", 3, "collar_knot_and_placket", "Upper-body portrait wearing collared dress shirt", "Silk necktie and bowtie"),
]


def build_120_case_v2_manifest_dict() -> dict[str, Any]:
    """
    Construct the deterministic 120-case v2.0 evaluation manifest structure.
    Ensures all unpopulated template cases have `person_image_path=None`,
    `product_image_path=None`, `image_readiness="missing_images"`, and
    `consent_verified=False` so an unpopulated template can never be mistaken
    for a completed or consented dataset.
    """
    cases_list: list[dict[str, Any]] = []
    idx = 1
    for cat, subcat, count, stress_group, p_cond, prod_cond in _V2_BLUEPRINT:
        spec = resolve_wearable_spec(cat, subcat)
        assert spec is not None, f"Missing WearableSpec for {cat}/{subcat}"
        for variant_num in range(1, count + 1):
            case_id = f"TC-{idx:03d}"
            idx += 1
            cases_list.append(
                {
                    "case_id": case_id,
                    "domain": spec.domain,
                    "category": cat,
                    "subcategory": subcat,
                    "title": f"{spec.label} benchmark #{variant_num} ({stress_group})",
                    "stress_group": stress_group,
                    "target_body_region": spec.target_body_region,
                    "required_landmarks": list(spec.required_landmarks),
                    "expected_routing_strategy": spec.routing_strategy,
                    "live_validation_status": spec.live_validation_status,
                    "person_condition": p_cond,
                    "product_condition": prod_cond,
                    "garment_photo_type": "flat-lay",
                    "person_image_path": None,
                    "product_image_path": None,
                    "image_readiness": "missing_images",
                    "permission_source": None,
                    "license_url": None,
                    "attribution": None,
                    "consent_verified": False,
                    "evaluation_record": {
                        "provider": None,
                        "model_version": None,
                        "generation_settings": {},
                        "status": "NOT_RUN",
                        "latency_ms": None,
                        "estimated_cost_usd": None,
                        "raw_output_path": None,
                        "final_output_path": None,
                        "comparison_strip_path": None,
                        "human_scores": {
                            "product_fidelity_1_to_5": None,
                            "placement_and_fit_1_to_5": None,
                            "identity_and_anatomy_preservation_1_to_5": None,
                            "occlusion_and_realism_1_to_5": None,
                            "lighting_pose_and_quality_robustness_1_to_5": None,
                            "evaluator_notes": "",
                        },
                    },
                }
            )
    assert len(cases_list) == 120, f"Expected 120 cases, got {len(cases_list)}"
    return {
        "schema_version": "2.0",
        "dataset_status": "template_incomplete_images",
        "notice": (
            "TEMPLATE MANIFEST ONLY — Image paths, permissions, and evaluation scores are "
            "intentionally unpopulated (null / consent_verified=false). Populate real consented "
            "image paths and set consent_verified=true with documented license_url before running "
            "live evaluation."
        ),
        "total_cases": len(cases_list),
        "ready_case_count": 0,
        "domain_allocations": {
            "clothing": 24,
            "jewellery": 20,
            "eyewear": 14,
            "wristwear": 12,
            "bags": 12,
            "footwear": 16,
            "headwear": 12,
            "accessories": 10,
        },
        "cases": cases_list,
    }


# ─── 20-Case Quality Pilot Specification (5 Clothing, 5 Necklaces/Pendants, 5 Earrings, 5 Eyewear) ───
_PILOT_20_BLUEPRINT: list[tuple[str, str, str, str, str, str, str]] = [
    # (case_id, pilot_group, category, subcategory, stress_group, person_condition, product_condition)
    # 1. Clothing (5 cases: PILOT-001 .. PILOT-005)
    (
        "PILOT-001",
        "clothing",
        "CLOTHING",
        "TSHIRT",
        "pilot_clothing_baseline",
        "Front-facing waist-up portrait, neutral indoor lighting, arms relaxed at sides",
        "Flat-lay short-sleeve crewneck cotton t-shirt with chest logo",
    ),
    (
        "PILOT-002",
        "clothing",
        "CLOTHING",
        "SHIRT",
        "pilot_clothing_tailored",
        "Front-facing upper-body portrait, neutral background",
        "Flat-lay long-sleeve oxford button-down shirt with structured collar",
    ),
    (
        "PILOT-003",
        "clothing",
        "CLOTHING",
        "JACKET",
        "pilot_clothing_outerwear",
        "Front-facing torso portrait wearing fitted base tee",
        "Flat-lay structured zip-up bomber/denim jacket",
    ),
    (
        "PILOT-004",
        "clothing",
        "CLOTHING",
        "SWEATER",
        "pilot_clothing_knitwear",
        "Front-facing portrait in short sleeves (tests long-sleeve extension over bare arms)",
        "Flat-lay long-sleeve cable-knit crewneck sweater",
    ),
    (
        "PILOT-005",
        "clothing",
        "CLOTHING",
        "TOP",
        "pilot_clothing_neckline_occlusion",
        "Front-facing portrait with visible collarbone and shoulder-length hair",
        "Clean catalog photo of V-neck draped blouse top",
    ),
    # 2. Necklaces / Pendants (5 cases: PILOT-006 .. PILOT-010)
    (
        "PILOT-006",
        "necklaces_pendants",
        "JEWELLERY",
        "NECKLACE",
        "pilot_necklace_clavicle_baseline",
        "Close upper-body portrait, 0-degree frontal pose, open scoop neckline exposing clavicles",
        "Isolated product image (RGBA/white bg) of curved collarbone statement necklace",
    ),
    (
        "PILOT-007",
        "necklaces_pendants",
        "JEWELLERY",
        "PENDANT",
        "pilot_pendant_central_drop",
        "Frontal portrait with visible suprasternal notch and bare chest/V-neckline",
        "High-resolution isolated product photo of thin metallic chain with central solitaire pendant",
    ),
    (
        "PILOT-008",
        "necklaces_pendants",
        "JEWELLERY",
        "NECKLACE",
        "pilot_necklace_pose_yaw",
        "Three-quarter (15-degree yaw) upper-body portrait with bare neck",
        "Isolated product photo of two-tier layered gold chain necklace",
    ),
    (
        "PILOT-009",
        "necklaces_pendants",
        "JEWELLERY",
        "PENDANT",
        "pilot_pendant_hair_occlusion",
        "Frontal portrait with long hair falling across left clavicle while central sternum is visible",
        "Isolated product photo of gold medallion pendant on medium link chain",
    ),
    (
        "PILOT-010",
        "necklaces_pendants",
        "JEWELLERY",
        "NECKLACE",
        "pilot_necklace_collar_occlusion",
        "Frontal portrait wearing open-collar button-down shirt (collar lapels occlude sides of neck)",
        "Isolated product photo of pearl/gold choker necklace",
    ),
    # 3. Earrings (5 cases: PILOT-011 .. PILOT-015)
    (
        "PILOT-011",
        "earrings",
        "JEWELLERY",
        "EARRINGS",
        "pilot_earrings_frontal_stud",
        "Frontal face portrait with hair tucked behind both ears, clear earlobes",
        "Isolated pair of diamond/metallic solitaire stud earrings",
    ),
    (
        "PILOT-012",
        "earrings",
        "JEWELLERY",
        "EARRINGS",
        "pilot_earrings_vertical_drop",
        "Frontal portrait with slight 10-degree head tilt (tests vertical gravity hang)",
        "Isolated product photo of elongated gemstone drop/dangle earrings",
    ),
    (
        "PILOT-013",
        "earrings",
        "JEWELLERY",
        "EARRINGS",
        "pilot_earrings_yaw_occlusion",
        "25-degree three-quarter face portrait where near earlobe is prominent and far earlobe is occluded",
        "Isolated product photo of medium gold hoop earrings",
    ),
    (
        "PILOT-014",
        "earrings",
        "JEWELLERY",
        "EARRINGS",
        "pilot_earrings_hair_occlusion",
        "Portrait with loose side hair partially covering upper ear helix while lower lobe is visible",
        "Isolated ornate chandelier earrings with fine filigree",
    ),
    (
        "PILOT-015",
        "earrings",
        "JEWELLERY",
        "EARRINGS",
        "pilot_earrings_lighting_match",
        "Warm indoor portrait with soft directional side lighting and neck shadow",
        "Isolated pearl-and-gold drop earrings",
    ),
    # 4. Eyewear (5 cases: PILOT-016 .. PILOT-020)
    (
        "PILOT-016",
        "eyewear",
        "EYEWEAR",
        "PRESCRIPTION_GLASSES",
        "pilot_eyewear_frontal_optical",
        "Frontal face portrait, neutral lighting, clear nasal bridge and eyes",
        "Isolated front-facing product photo of thin metallic wire-rim optical frames",
    ),
    (
        "PILOT-017",
        "eyewear",
        "EYEWEAR",
        "PRESCRIPTION_GLASSES",
        "pilot_eyewear_yaw_perspective",
        "15-degree three-quarter face portrait showing nasal bridge and near temple",
        "Isolated tortoise-shell acetate optical frames",
    ),
    (
        "PILOT-018",
        "eyewear",
        "EYEWEAR",
        "SUNGLASSES",
        "pilot_eyewear_gradient_tint",
        "Frontal outdoor/daylight portrait",
        "Isolated gold-frame aviator sunglasses with gradient tinted lenses",
    ),
    (
        "PILOT-019",
        "eyewear",
        "EYEWEAR",
        "SUNGLASSES",
        "pilot_eyewear_temple_hair_occlusion",
        "Portrait with hair/bangs partially overlapping the outer temple area",
        "Isolated dark wayfarer/cat-eye acetate sunglasses",
    ),
    (
        "PILOT-020",
        "eyewear",
        "EYEWEAR",
        "PRESCRIPTION_GLASSES",
        "pilot_eyewear_fine_rimless",
        "Close frontal face portrait under bright indoor light",
        "Isolated semi-rimless optical glasses",
    ),
]


def build_20_case_pilot_manifest_dict() -> dict[str, Any]:
    """
    Construct the reproducible 20-case quality pilot manifest (`v2.1-pilot20`):
    - 5 clothing cases (`PILOT-001` .. `PILOT-005`)
    - 5 necklaces/pendants cases (`PILOT-006` .. `PILOT-010`)
    - 5 earrings cases (`PILOT-011` .. `PILOT-015`)
    - 5 eyewear cases (`PILOT-016` .. `PILOT-020`)

    Because real consented images are not bundled in the repository, all image
    paths, permissions, and human scores are explicitly left unpopulated (`None`
    and `consent_verified=False`) with `missing_inputs` enumerated on every case.
    """
    cases_list: list[dict[str, Any]] = []
    required_input_fields = [
        "person_image_path",
        "product_image_path",
        "permission_source",
        "license_url",
        "attribution",
        "consent_verified",
    ]
    for case_id, pilot_group, cat, subcat, stress_group, p_cond, prod_cond in _PILOT_20_BLUEPRINT:
        spec = resolve_wearable_spec(cat, subcat)
        assert spec is not None, f"Missing WearableSpec for {cat}/{subcat}"
        support_status = (
            "supported"
            if spec.live_validation_status == "verified_live_idm_vton"
            else "requires_specialized_model"
        )
        cases_list.append(
            {
                "case_id": case_id,
                "pilot_group": pilot_group,
                "domain": spec.domain,
                "category": cat,
                "subcategory": subcat,
                "title": f"{spec.label} pilot ({stress_group})",
                "stress_group": stress_group,
                "target_body_region": spec.target_body_region,
                "required_landmarks": list(spec.required_landmarks),
                "expected_routing_strategy": spec.routing_strategy,
                "live_validation_status": spec.live_validation_status,
                "provider_support_status": support_status,
                "person_condition": p_cond,
                "product_condition": prod_cond,
                "garment_photo_type": "flat-lay",
                "person_image_path": None,
                "product_image_path": None,
                "image_readiness": "missing_images",
                "missing_inputs": list(required_input_fields),
                "permission_source": None,
                "license_url": None,
                "attribution": None,
                "consent_verified": False,
                "evaluation_record": {
                    "provider": None,
                    "model_version": None,
                    "generation_settings": {},
                    "status": "NOT_RUN",
                    "latency_ms": None,
                    "estimated_cost_usd": None,
                    "raw_output_path": None,
                    "mask_output_path": None,
                    "final_output_path": None,
                    "comparison_strip_path": None,
                    "human_scores": {
                        "product_fidelity_1_to_5": None,
                        "placement_and_fit_1_to_5": None,
                        "identity_and_anatomy_preservation_1_to_5": None,
                        "occlusion_and_realism_1_to_5": None,
                        "lighting_pose_and_quality_robustness_1_to_5": None,
                        "evaluator_notes": "",
                    },
                },
            }
        )
    assert len(cases_list) == 20, f"Expected 20 pilot cases, got {len(cases_list)}"
    return {
        "schema_version": "2.1-pilot20",
        "milestone": "20-case-quality-pilot",
        "dataset_status": "template_incomplete_images",
        "notice": (
            "INCOMPLETE 20-CASE PILOT TEMPLATE — Real person/product image paths, permissions, "
            "consent verification, and human evaluation scores are intentionally unpopulated "
            "(null / consent_verified=false). Populate real consented image paths and set "
            "consent_verified=true before running live inference."
        ),
        "total_cases": 20,
        "ready_case_count": 0,
        "missing_input_case_count": 20,
        "required_inputs_per_case": required_input_fields,
        "pilot_category_allocations": {
            "clothing": 5,
            "necklaces_pendants": 5,
            "earrings": 5,
            "eyewear": 5,
        },
        "provider_validation_summary": {
            "clothing": "verified_live_idm_vton (non-commercial) / fashn-api (commercial)",
            "necklaces_pendants": "requires_specialized_model (no validated live provider yet)",
            "earrings": "requires_specialized_model (no validated live provider yet)",
            "eyewear": "requires_specialized_model (no validated live provider yet)",
        },
        "cases": cases_list,
    }


def validate_pilot_manifest(manifest_data: dict[str, Any]) -> dict[str, Any]:
    """
    Validate a 20-case quality pilot manifest dictionary.

    Enforces:
    1. Exact 20-case structure: 5 clothing, 5 necklaces/pendants, 5 earrings, 5 eyewear.
    2. Valid taxonomy resolution (`resolve_wearable_spec`) for every case.
    3. Honest completeness status: cannot claim `dataset_status == "ready"` when any case
       is missing existing image files on disk or has `consent_verified == False`.
    4. Blank human scores (`None`) whenever `evaluation_record.status == "NOT_RUN"`.
    """
    if not isinstance(manifest_data, dict) or "cases" not in manifest_data:
        raise ValueError("Pilot manifest must be a JSON object containing a 'cases' list.")

    cases_raw = manifest_data["cases"]
    if len(cases_raw) != 20:
        raise ValueError(f"Pilot manifest must contain exactly 20 cases, got {len(cases_raw)}.")

    group_counts = {
        "clothing": 0,
        "necklaces_pendants": 0,
        "earrings": 0,
        "eyewear": 0,
    }
    missing_by_case: dict[str, list[str]] = {}
    ready_count = 0

    for item in cases_raw:
        cid = item.get("case_id", "")
        cat = item.get("category", "")
        subcat = item.get("subcategory", "")
        spec = resolve_wearable_spec(cat, subcat)
        if spec is None:
            raise ValueError(f"Case '{cid}' has unknown category/subcategory '{cat}/{subcat}'.")

        if spec.domain == "clothing":
            group_counts["clothing"] += 1
        elif spec.subcategory in ("NECKLACE", "PENDANT", "CHAIN"):
            group_counts["necklaces_pendants"] += 1
        elif spec.subcategory == "EARRINGS":
            group_counts["earrings"] += 1
        elif spec.domain == "eyewear":
            group_counts["eyewear"] += 1
        else:
            raise ValueError(
                f"Case '{cid}' ({spec.domain}/{spec.subcategory}) is outside the 4 pilot groups "
                "(clothing, necklaces_pendants, earrings, eyewear)."
            )

        p_path = item.get("person_image_path")
        g_path = item.get("product_image_path") or item.get("garment_image_path")
        missing: list[str] = []
        if not p_path or not Path(p_path).is_file():
            missing.append("person_image_path")
        if not g_path or not Path(g_path).is_file():
            missing.append("product_image_path")
        if not (item.get("permission_source") or "").strip():
            missing.append("permission_source")
        if not (item.get("license_url") or "").strip():
            missing.append("license_url")
        if not (item.get("attribution") or "").strip():
            missing.append("attribution")
        if not bool(item.get("consent_verified", False)):
            missing.append("consent_verified")

        if missing:
            missing_by_case[cid] = missing
        else:
            ready_count += 1

        eval_rec = item.get("evaluation_record") or {}
        scores = eval_rec.get("human_scores") or {}
        score_keys = (
            "product_fidelity_1_to_5",
            "placement_and_fit_1_to_5",
            "identity_and_anatomy_preservation_1_to_5",
            "occlusion_and_realism_1_to_5",
            "lighting_pose_and_quality_robustness_1_to_5",
        )
        if eval_rec.get("status", "NOT_RUN") == "NOT_RUN":
            for sk in score_keys:
                if scores.get(sk) is not None:
                    raise ValueError(
                        f"Case '{cid}' has status='NOT_RUN' but non-blank human score '{sk}={scores.get(sk)}'."
                    )

    expected_groups = {
        "clothing": 5,
        "necklaces_pendants": 5,
        "earrings": 5,
        "eyewear": 5,
    }
    if group_counts != expected_groups:
        raise ValueError(
            f"Pilot manifest category allocation mismatch: expected {expected_groups}, got {group_counts}."
        )

    declared_status = manifest_data.get("dataset_status")
    if declared_status == "ready" and ready_count < 20:
        raise ValueError(
            f"Manifest declares dataset_status='ready' but only {ready_count}/20 cases have verified "
            "existing images and permissions."
        )

    return {
        "valid": True,
        "total_cases": 20,
        "ready_case_count": ready_count,
        "missing_input_case_count": len(missing_by_case),
        "group_counts": group_counts,
        "missing_inputs_by_case": missing_by_case,
    }


def load_manifest_cases(manifest_path: Path) -> tuple[list[EvalCase], dict[str, Any]]:
    """
    Load either a v1 list manifest (`eval_manifest.example.json`) or a v2.0
    versioned manifest object (`eval_manifest.v2.example.json`).
    """
    raw_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if isinstance(raw_data, list):
        cases: list[EvalCase] = []
        for item in raw_data:
            spec = resolve_wearable_spec(item.get("category", "TSHIRT"), item.get("subcategory"))
            p_path = item.get("person_image_path")
            g_path = item.get("product_image_path") or item.get("garment_image_path")
            cases.append(
                EvalCase(
                    case_id=item["case_id"],
                    title=item["title"],
                    category=item["category"],
                    subcategory=item.get("subcategory") or item["category"],
                    domain=item.get("domain") or (spec.domain if spec else "clothing"),
                    stress_group=item.get("stress_group", "general"),
                    target_body_region=item.get("target_body_region")
                    or (spec.target_body_region if spec else "upper_body_torso"),
                    required_landmarks=item.get("required_landmarks")
                    or (list(spec.required_landmarks) if spec else []),
                    expected_routing_strategy=item.get("expected_routing_strategy")
                    or (spec.routing_strategy if spec else "diffusion_upper_body"),
                    person_condition=item.get("person_condition", ""),
                    garment_condition=item.get("product_condition") or item.get("garment_condition", ""),
                    garment_photo_type=item.get("garment_photo_type", "flat-lay"),
                    person_image_path=p_path,
                    garment_image_path=g_path,
                    product_image_path=g_path,
                    image_readiness=item.get(
                        "image_readiness",
                        "ready" if (p_path and g_path) else "missing_images",
                    ),
                    permission_source=item.get("permission_source"),
                    license_url=item.get("license_url"),
                    attribution=item.get("attribution"),
                    consent_verified=bool(item.get("consent_verified", False)),
                )
            )
        ready_count = sum(1 for c in cases if c.image_readiness == "ready")
        meta = {
            "schema_version": "1.0",
            "dataset_status": "ready" if ready_count == len(cases) else "template_incomplete_images",
            "total_cases": len(cases),
            "ready_case_count": ready_count,
        }
        return cases, meta

    if isinstance(raw_data, dict) and "cases" in raw_data:
        cases = []
        for item in raw_data["cases"]:
            spec = resolve_wearable_spec(item.get("category", "TSHIRT"), item.get("subcategory"))
            p_path = item.get("person_image_path")
            g_path = item.get("product_image_path") or item.get("garment_image_path")
            has_both_files = bool(
                p_path
                and g_path
                and Path(p_path).is_file()
                and Path(g_path).is_file()
            )
            cases.append(
                EvalCase(
                    case_id=item["case_id"],
                    title=item["title"],
                    category=item["category"],
                    subcategory=item.get("subcategory") or item["category"],
                    domain=item.get("domain") or (spec.domain if spec else "clothing"),
                    stress_group=item.get("stress_group", "general"),
                    target_body_region=item.get("target_body_region")
                    or (spec.target_body_region if spec else "upper_body_torso"),
                    required_landmarks=item.get("required_landmarks")
                    or (list(spec.required_landmarks) if spec else []),
                    expected_routing_strategy=item.get("expected_routing_strategy")
                    or (spec.routing_strategy if spec else "diffusion_upper_body"),
                    person_condition=item.get("person_condition", ""),
                    garment_condition=item.get("product_condition") or item.get("garment_condition", ""),
                    garment_photo_type=item.get("garment_photo_type", "flat-lay"),
                    person_image_path=p_path,
                    garment_image_path=g_path,
                    product_image_path=g_path,
                    image_readiness="ready" if has_both_files else "missing_images",
                    permission_source=item.get("permission_source"),
                    license_url=item.get("license_url"),
                    attribution=item.get("attribution"),
                    consent_verified=bool(item.get("consent_verified", False)),
                )
            )
        ready_count = sum(1 for c in cases if c.image_readiness == "ready")
        meta = {
            "schema_version": raw_data.get("schema_version", "2.0"),
            "dataset_status": "ready" if (cases and ready_count == len(cases)) else "template_incomplete_images",
            "total_cases": len(cases),
            "ready_case_count": ready_count,
        }
        return cases, meta

    raise ValueError(f"Invalid manifest structure in {manifest_path}")


def verify_case_permission(case: EvalCase) -> None:
    """
    Ensure explicit permission and provenance metadata are present before using
    any evaluation image pair.
    """
    if not case.consent_verified:
        raise PermissionError(
            f"Case {case.case_id} cannot be evaluated: 'consent_verified' is False. "
            "Explicit permission is required before running virtual try-on evaluation on person/product images."
        )
    if not (case.permission_source or "").strip():
        raise PermissionError(
            f"Case {case.case_id} is missing required 'permission_source' provenance metadata."
        )
    if not (case.license_url or "").strip() and not (case.attribution or "").strip():
        raise PermissionError(
            f"Case {case.case_id} must specify 'license_url' or 'attribution' documenting image usage rights."
        )


def _make_synthetic_image(
    color: tuple[int, int, int],
    size: tuple[int, int] = (768, 1024),
    label: str = "",
) -> bytes:
    img = Image.new("RGB", size, color=color)
    draw = ImageDraw.Draw(img)
    w, h = size
    draw.rectangle([w // 4, h // 5, (w * 3) // 4, (h * 3) // 5], outline=(240, 240, 240), width=3)
    if label:
        draw.text((24, 24), label, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _load_image_or_synthetic(
    path_str: str | None,
    fallback_color: tuple[int, int, int],
    allow_synthetic: bool,
    label: str,
) -> bytes:
    if path_str:
        p = Path(path_str)
        if not p.is_file():
            raise FileNotFoundError(f"Evaluation image not found: {p}")
        return p.read_bytes()
    if not allow_synthetic:
        raise ValueError(
            f"Missing real image file for '{label}' (image_readiness='missing_images') "
            "and synthetic fallback is disabled."
        )
    return _make_synthetic_image(fallback_color, label=label)


def _inspect_image_bytes(img_bytes: bytes) -> tuple[str, str, str]:
    """Return (sha256_hex_prefix, 'WxH', ext) after verifying full image decode."""
    if not img_bytes:
        raise ValueError("Image payload is empty (0 bytes).")
    digest = hashlib.sha256(img_bytes).hexdigest()[:16]
    with Image.open(io.BytesIO(img_bytes)) as img:
        img.load()
        w, h = img.size
        if w <= 0 or h <= 0:
            raise ValueError(f"Invalid image dimensions: {w}x{h}")
        fmt = (img.format or "JPEG").upper()
    ext_map = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
    return digest, f"{w}x{h}", ext_map.get(fmt, "jpg")


def build_comparison_strip(
    panel_paths: list[tuple[str, Path | None]],
    dest_path: Path,
    panel_height: int = 512,
) -> str | None:
    """
    Create a side-by-side contact sheet (`07_comparison_strip.jpg`) from available
    evaluation stage images (`Person | Product | Raw Output | Mask | Final Output`)
    so human evaluators can inspect raw vs. post-processed results directly.
    """
    loaded_panels: list[tuple[str, Image.Image]] = []
    for title, path in panel_paths:
        if path and path.is_file():
            try:
                with Image.open(path) as im:
                    rgb = im.convert("RGB")
                    scale = panel_height / float(max(1, rgb.height))
                    new_w = max(64, int(round(rgb.width * scale)))
                    resized = rgb.resize((new_w, panel_height), Image.LANCZOS)
                    loaded_panels.append((title, resized))
            except Exception:
                continue

    if not loaded_panels:
        return None

    header_h = 36
    gap = 8
    total_w = sum(im.width for _, im in loaded_panels) + gap * (len(loaded_panels) + 1)
    total_h = panel_height + header_h + gap * 2

    strip = Image.new("RGB", (total_w, total_h), color=(24, 24, 28))
    draw = ImageDraw.Draw(strip)

    x_cursor = gap
    for title, im in loaded_panels:
        draw.text((x_cursor + 6, 10), title, fill=(235, 235, 245))
        strip.paste(im, (x_cursor, header_h + gap))
        x_cursor += im.width + gap

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(dest_path, format="JPEG", quality=92)
    return str(dest_path)


class BenchmarkAdapter:
    """
    Category-aware benchmark adapter wrapping a WearMe VTONProvider via
    `CategoryRouterProvider` while recording model version, settings,
    estimated cost, and raw/composited artifacts.
    """

    def __init__(
        self,
        adapter_name: str,
        provider: VTONProvider,
        model_version: str,
        settings: dict[str, Any],
        cost_per_credit_usd: float = 0.0,
        allow_extended_mock: bool = False,
        enable_necklace_poc: bool = False,
    ) -> None:
        self.adapter_name = adapter_name
        self.provider = provider
        self.allow_extended_mock = allow_extended_mock
        self.enable_necklace_poc = enable_necklace_poc
        self.router = (
            provider
            if isinstance(provider, CategoryRouterProvider)
            else CategoryRouterProvider(
                provider,
                allow_extended_mock=allow_extended_mock,
                enable_necklace_poc=enable_necklace_poc,
            )
        )
        self.model_version = model_version
        self.settings = settings
        self.cost_per_credit_usd = cost_per_credit_usd

    async def run_case(
        self,
        case: EvalCase,
        person_bytes: bytes,
        person_ext: str,
        garment_bytes: bytes,
        garment_ext: str,
        case_dir: Path,
    ) -> tuple[bytes, dict[str, Any], dict[str, str]]:
        case_dir.mkdir(parents=True, exist_ok=True)

        p_orig = case_dir / f"01_person_orig.{person_ext}"
        g_orig = case_dir / f"02_product_orig.{garment_ext}"
        p_orig.write_bytes(person_bytes)
        g_orig.write_bytes(garment_bytes)

        out_bytes, _, meta = await self.router.process(
            job_id=f"eval-{case.case_id.lower()}",
            person_image_bytes=person_bytes,
            garment_image_bytes=garment_bytes,
            category=case.category,
            subcategory=case.subcategory,
            debug_artifact_dir=case_dir,
        )

        artifacts = dict(meta.get("debug_artifacts") or {})
        artifacts.setdefault("person_orig", str(p_orig))
        artifacts.setdefault("garment_orig", str(g_orig))

        if "provider_raw_output" not in artifacts:
            raw_file = case_dir / "04_provider_raw_output.jpg"
            raw_file.write_bytes(out_bytes)
            artifacts["provider_raw_output"] = str(raw_file)

        if "final_composited" not in artifacts:
            final_file = case_dir / "06_final_composited.jpg"
            final_file.write_bytes(out_bytes)
            artifacts["final_composited"] = str(final_file)

        strip_path = build_comparison_strip(
            [
                ("1. Person Input", Path(artifacts["person_orig"]) if "person_orig" in artifacts else None),
                ("2. Product Input", Path(artifacts["garment_orig"]) if "garment_orig" in artifacts else None),
                (
                    "3. Raw Provider Output",
                    Path(artifacts.get("provider_raw_unpadded") or artifacts.get("provider_raw_output", ""))
                    if (artifacts.get("provider_raw_unpadded") or artifacts.get("provider_raw_output"))
                    else None,
                ),
                (
                    "4. Provider Mask",
                    Path(artifacts["provider_mask"]) if "provider_mask" in artifacts else None,
                ),
                (
                    "5. Final Output",
                    Path(artifacts["final_composited"]) if "final_composited" in artifacts else None,
                ),
            ],
            case_dir / "07_comparison_strip.jpg",
        )
        if strip_path:
            artifacts["comparison_strip"] = strip_path

        return out_bytes, meta, artifacts


def build_adapter_for_provider(
    provider_choice: str,
    fashn_model: str = "tryon-v1.6",
    fashn_mode: str = "balanced",
    hf_denoise_steps: int = 30,
    hf_seed: int = 42,
    allow_extended_mock: bool = False,
    allow_uncredentialed_init: bool = False,
    enable_necklace_poc: bool = False,
) -> BenchmarkAdapter:
    norm = provider_choice.strip().lower()
    env_poc = os.environ.get("ENABLE_NECKLACE_POC", "").strip().lower() in ("1", "true", "yes")
    effective_poc = enable_necklace_poc or env_poc

    if norm == "mock":
        return BenchmarkAdapter(
            adapter_name="mock",
            provider=MockProvider(allow_extended_categories=allow_extended_mock),
            model_version="pillow-mock-v1",
            settings={
                "watermark": True,
                "compositing": "upper_body_overlay",
                "enable_necklace_poc": effective_poc,
            },
            cost_per_credit_usd=0.0,
            allow_extended_mock=allow_extended_mock,
            enable_necklace_poc=effective_poc,
        )

    if norm in ("necklace-poc", "landmark_jewellery_neck"):
        poc_prov = NecklacePocProvider(enabled=effective_poc)
        return BenchmarkAdapter(
            adapter_name="necklace-poc",
            provider=poc_prov,
            model_version=NecklacePocProvider.VERSION,
            settings={
                "routing_strategy": "landmark_jewellery_neck",
                "supported_subcategories": ["NECKLACE", "PENDANT"],
                "enable_necklace_poc": effective_poc,
                "is_experimental_poc": True,
            },
            cost_per_credit_usd=0.0,
            enable_necklace_poc=effective_poc,
        )

    if norm in ("huggingface", "idm-vton"):
        hf_token = (
            os.environ.get("HF_TOKEN", "").strip()
            or os.environ.get("AI_API_KEY", "").strip()
        )
        space_id = os.environ.get("HF_SPACE_ID", "yisol/IDM-VTON").strip()
        timeout_sec = float(os.environ.get("AI_REQUEST_TIMEOUT_SECONDS", "180"))
        hf_prov = HuggingFaceProvider(
            hf_token=hf_token,
            space_id=space_id,
            timeout_seconds=timeout_sec,
            denoise_steps=hf_denoise_steps,
            seed=hf_seed,
        )
        return BenchmarkAdapter(
            adapter_name="idm-vton",
            provider=hf_prov,
            model_version=space_id,
            settings={
                "space_id": space_id,
                "api_name": "/tryon",
                "denoise_steps": hf_denoise_steps,
                "seed": hf_seed,
                "is_checked_auto_mask": True,
                "is_checked_crop": False,
                "local_3x4_padding": True,
                "upper_body_compositing": True,
                "authenticated_hf": bool(hf_token),
                "license": "CC BY-NC-SA 4.0 (Non-Commercial Only)",
                "enable_necklace_poc": effective_poc,
            },
            cost_per_credit_usd=0.0,
            enable_necklace_poc=effective_poc,
        )

    if norm in ("fashn-api", "fashn-v1.6", "fashn-tryon-max"):
        api_key = os.environ.get("AI_API_KEY", "").strip()
        if not api_key and not allow_uncredentialed_init:
            raise ValueError(
                "BLOCKED: AI_API_KEY is not set in the environment. "
                "Cannot execute live FASHN API evaluation without credentials."
            )
        target_model = "tryon-max" if norm == "fashn-tryon-max" else fashn_model
        fashn_prov = FASHNApiProvider(
            api_key=api_key or "dry-run-uncredentialed",
            model_name=target_model,
            mode=fashn_mode,
            return_base64=True,
            validate_on_init=not allow_uncredentialed_init,
            allow_extended_clothing=True,
        )
        adapter_label = "fashn-tryon-max" if target_model == "tryon-max" else "fashn-v1.6"
        return BenchmarkAdapter(
            adapter_name=adapter_label,
            provider=fashn_prov,
            model_version=target_model,
            settings={
                "model_name": target_model,
                "mode": fashn_mode,
                "return_base64": True,
                "garment_photo_type": "auto",
                "moderation_level": "permissive",
                "enable_necklace_poc": effective_poc,
            },
            cost_per_credit_usd=0.075,
            enable_necklace_poc=effective_poc,
        )

    raise ValueError(f"Unsupported provider adapter '{provider_choice}'.")


async def run_evaluation(
    provider: VTONProvider | BenchmarkAdapter,
    cases: list[EvalCase],
    output_dir: Path,
    allow_synthetic_for_mock: bool = True,
    run_id: str | None = None,
    dry_run: bool = False,
) -> list[EvalResult]:
    """
    Execute the evaluation suite across all supplied cases and persist raw +
    post-processed outputs, comparison strips, and structured telemetry.

    Safeguards:
    - Mandatory permission validation (`verify_case_permission`) runs before any image is loaded.
    - Categories without a validated live provider report `requires_specialized_model` or
      `unsupported` and are never routed to IDM-VTON, FASHN clothing inference, or mock output
      as though they were real.
    - When `dry_run=True`, zero GPU quota and $0 API credits are consumed.
    """
    if isinstance(provider, BenchmarkAdapter):
        adapter = provider
    else:
        allow_ext = bool(getattr(provider, "_allow_extended", False))
        adapter = BenchmarkAdapter(
            adapter_name=provider.name,
            provider=provider,
            model_version=getattr(
                provider,
                "_model_name",
                getattr(provider, "_space_id", "pillow-mock-v1" if provider.name == "mock" else provider.name),
            ),
            settings={},
            cost_per_credit_usd=0.075 if provider.name == "fashn-api" else 0.0,
            allow_extended_mock=allow_ext,
        )

    active_run_id = run_id or f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{adapter.adapter_name}"
    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[EvalResult] = []

    for idx, case in enumerate(cases, start=1):
        start_ms = int(time.time() * 1000)
        timestamp_utc = datetime.now(timezone.utc).isoformat()
        case_dir = output_dir / case.case_id / adapter.adapter_name
        spec, support_status, selected_route = adapter.router.classify_support(
            case.category, case.subcategory
        )
        domain = spec.domain if spec else case.domain
        subcat = spec.subcategory if spec else case.effective_subcategory
        target_region = spec.target_body_region if spec else case.target_body_region
        req_landmarks = list(spec.required_landmarks) if spec else list(case.required_landmarks)
        routing_strat = spec.routing_strategy if spec else case.expected_routing_strategy
        live_status = spec.live_validation_status if spec else "unverified"
        missing_inputs = case.compute_missing_inputs()

        if dry_run:
            duration_ms = int(time.time() * 1000) - start_ms
            if support_status in ("requires_specialized_model", "unsupported"):
                msg = (
                    f"Category '{subcat}' (domain='{domain}', strategy='{routing_strat}') "
                    f"reports '{support_status}' ({live_status}); not routed to IDM-VTON, "
                    "FASHN clothing inference, or mock output."
                )
                results.append(
                    EvalResult(
                        run_id=active_run_id,
                        timestamp_utc=timestamp_utc,
                        case_id=case.case_id,
                        title=case.title,
                        domain=domain,
                        category=case.category,
                        subcategory=subcat,
                        stress_group=case.stress_group,
                        target_body_region=target_region,
                        required_landmarks=req_landmarks,
                        routing_strategy=routing_strat,
                        live_validation_status=live_status,
                        adapter_name=adapter.adapter_name,
                        provider=adapter.provider.name,
                        model_version=adapter.model_version,
                        provider_settings={**adapter.settings, "dry_run": True},
                        image_readiness=case.image_readiness,
                        permission_source=case.permission_source,
                        license_url=case.license_url,
                        consent_verified=case.consent_verified,
                        person_sha256=None,
                        person_dimensions=None,
                        garment_sha256=None,
                        garment_dimensions=None,
                        status=support_status,
                        duration_ms=duration_ms,
                        provider_inference_ms=None,
                        prediction_id=None,
                        credits_used="0",
                        estimated_cost_usd=0.0,
                        person_orig_path=None,
                        garment_orig_path=None,
                        preprocessed_person_path=None,
                        raw_output_path=None,
                        raw_unpadded_path=None,
                        mask_output_path=None,
                        output_path=None,
                        comparison_strip_path=None,
                        error_category=support_status,
                        error_message=msg,
                        provider_support_status=support_status,
                        missing_inputs=missing_inputs,
                    )
                )
            else:
                can_use_synthetic = adapter.provider.name == "mock" and allow_synthetic_for_mock
                has_perm = (
                    case.consent_verified
                    and bool((case.permission_source or "").strip())
                    and bool((case.license_url or "").strip() or (case.attribution or "").strip())
                )
                has_imgs = (
                    "person_image_path" not in missing_inputs
                    and "product_image_path" not in missing_inputs
                ) or can_use_synthetic
                dry_status = "DRY_RUN_READY" if (has_perm and has_imgs) else "DRY_RUN_MISSING_INPUTS"
                err_cat = None if dry_status == "DRY_RUN_READY" else "missing_inputs_or_permission"
                err_msg = (
                    None
                    if dry_status == "DRY_RUN_READY"
                    else f"Missing required inputs/permissions: {', '.join(missing_inputs)}"
                )
                results.append(
                    EvalResult(
                        run_id=active_run_id,
                        timestamp_utc=timestamp_utc,
                        case_id=case.case_id,
                        title=case.title,
                        domain=domain,
                        category=case.category,
                        subcategory=subcat,
                        stress_group=case.stress_group,
                        target_body_region=target_region,
                        required_landmarks=req_landmarks,
                        routing_strategy=routing_strat,
                        live_validation_status=live_status,
                        adapter_name=adapter.adapter_name,
                        provider=adapter.provider.name,
                        model_version=adapter.model_version,
                        provider_settings={
                            **adapter.settings,
                            "dry_run": True,
                            "selected_route": selected_route,
                        },
                        image_readiness=case.image_readiness,
                        permission_source=case.permission_source,
                        license_url=case.license_url,
                        consent_verified=case.consent_verified,
                        person_sha256=None,
                        person_dimensions=None,
                        garment_sha256=None,
                        garment_dimensions=None,
                        status=dry_status,
                        duration_ms=duration_ms,
                        provider_inference_ms=None,
                        prediction_id=None,
                        credits_used="0",
                        estimated_cost_usd=0.0,
                        person_orig_path=None,
                        garment_orig_path=None,
                        preprocessed_person_path=None,
                        raw_output_path=None,
                        raw_unpadded_path=None,
                        mask_output_path=None,
                        output_path=None,
                        comparison_strip_path=None,
                        error_category=err_cat,
                        error_message=err_msg,
                        provider_support_status=support_status,
                        missing_inputs=missing_inputs,
                    )
                )
            continue

        try:
            # 1. Mandatory permission & provenance validation before loading any images
            verify_case_permission(case)

            # 2. Check category routing & live provider validation before loading images
            # or invoking IDM-VTON, FASHN clothing inference, or MockProvider
            adapter.router.resolve_route(case.category, case.subcategory)
            if support_status in ("requires_specialized_model", "unsupported"):
                raise VTONError(
                    f"Category '{subcat}' (domain='{domain}') has no validated live provider "
                    f"('{support_status}') and cannot be routed to '{adapter.provider.name}'.",
                    category=support_status,
                    status_code=422,
                    retryable=False,
                )

            prod_path = case.effective_product_path
            if adapter.provider.name != "mock" and (
                not case.person_image_path or not prod_path
            ):
                raise ValueError(
                    f"Case {case.case_id} ({subcat}) has image_readiness='missing_images'. "
                    f"Real person_image_path and product_image_path are required for provider '{adapter.provider.name}'."
                )

            can_use_synthetic = adapter.provider.name == "mock" and allow_synthetic_for_mock
            person_bytes = _load_image_or_synthetic(
                case.person_image_path,
                (200, 185, 175),
                allow_synthetic=can_use_synthetic,
                label=f"{case.case_id}_person",
            )
            garment_bytes = _load_image_or_synthetic(
                prod_path,
                (35 + (idx * 7) % 160, 90, 180),
                allow_synthetic=can_use_synthetic,
                label=f"{case.case_id}_{subcat}",
            )

            p_sha, p_dims, p_ext = _inspect_image_bytes(person_bytes)
            g_sha, g_dims, g_ext = _inspect_image_bytes(garment_bytes)

            out_bytes, meta, artifacts = await adapter.run_case(
                case=case,
                person_bytes=person_bytes,
                person_ext=p_ext,
                garment_bytes=garment_bytes,
                garment_ext=g_ext,
                case_dir=case_dir,
            )
            duration_ms = int(time.time() * 1000) - start_ms

            legacy_out_file = output_dir / f"{case.case_id}_{adapter.provider.name}.jpg"
            legacy_out_file.write_bytes(out_bytes)

            final_out_path_str = artifacts.get("final_composited") or str(legacy_out_file)
            final_out_file = Path(final_out_path_str)
            if not final_out_file.is_file() or final_out_file.stat().st_size == 0:
                raise ValueError(
                    f"Persisted final output file '{final_out_file}' is missing or empty."
                )

            out_sha, _, _ = _inspect_image_bytes(final_out_file.read_bytes())
            raw_out_path_str = artifacts.get("provider_raw_output")
            raw_sha: str | None = None
            if raw_out_path_str and Path(raw_out_path_str).is_file():
                raw_sha, _, _ = _inspect_image_bytes(Path(raw_out_path_str).read_bytes())

            default_credits = (
                "0"
                if adapter.provider.name in ("mock", "huggingface")
                else ("2" if adapter.model_version == "tryon-max" else "1")
            )
            credits_str = str(meta.get("credits_used") or default_credits)
            try:
                credits_float = float(credits_str)
            except ValueError:
                credits_float = 0.0
            est_cost = round(credits_float * adapter.cost_per_credit_usd, 4)

            case_settings = {
                **adapter.settings,
                "garment_photo_type_case": case.garment_photo_type,
                "selected_route": meta.get("selected_route"),
            }
            if "garment_description" in meta:
                case_settings["garment_description"] = meta["garment_description"]

            results.append(
                EvalResult(
                    run_id=active_run_id,
                    timestamp_utc=timestamp_utc,
                    case_id=case.case_id,
                    title=case.title,
                    domain=domain,
                    category=case.category,
                    subcategory=subcat,
                    stress_group=case.stress_group,
                    target_body_region=target_region,
                    required_landmarks=req_landmarks,
                    routing_strategy=routing_strat,
                    live_validation_status=live_status,
                    adapter_name=adapter.adapter_name,
                    provider=adapter.provider.name,
                    model_version=adapter.model_version,
                    provider_settings=case_settings,
                    image_readiness="ready" if (case.person_image_path and prod_path) else "synthetic_mock_only",
                    permission_source=case.permission_source,
                    license_url=case.license_url,
                    consent_verified=case.consent_verified,
                    person_sha256=p_sha,
                    person_dimensions=p_dims,
                    garment_sha256=g_sha,
                    garment_dimensions=g_dims,
                    status="COMPLETED",
                    duration_ms=duration_ms,
                    provider_inference_ms=meta.get("elapsed_ms"),
                    prediction_id=meta.get("prediction_id"),
                    credits_used=credits_str,
                    estimated_cost_usd=est_cost,
                    person_orig_path=artifacts.get("person_orig"),
                    garment_orig_path=artifacts.get("garment_orig"),
                    preprocessed_person_path=artifacts.get("person_preprocessed"),
                    raw_output_path=raw_out_path_str,
                    raw_unpadded_path=artifacts.get("provider_raw_unpadded"),
                    mask_output_path=artifacts.get("provider_mask"),
                    output_path=str(legacy_out_file),
                    comparison_strip_path=artifacts.get("comparison_strip"),
                    error_category=None,
                    error_message=None,
                    provider_support_status=support_status,
                    missing_inputs=missing_inputs,
                    raw_output_sha256=raw_sha,
                    output_sha256=out_sha,
                    final_output_path=artifacts.get("final_composited") or str(legacy_out_file),
                )
            )
        except VTONError as err:
            duration_ms = int(time.time() * 1000) - start_ms
            if (
                err.category == "requires_specialized_model"
                or support_status == "requires_specialized_model"
            ):
                reported_status = "requires_specialized_model"
            elif (
                err.category in ("unsupported", "unsupported_category_for_provider")
                or support_status == "unsupported"
            ):
                reported_status = "unsupported"
            else:
                reported_status = "FAILED"
            results.append(
                EvalResult(
                    run_id=active_run_id,
                    timestamp_utc=timestamp_utc,
                    case_id=case.case_id,
                    title=case.title,
                    domain=domain,
                    category=case.category,
                    subcategory=subcat,
                    stress_group=case.stress_group,
                    target_body_region=target_region,
                    required_landmarks=req_landmarks,
                    routing_strategy=routing_strat,
                    live_validation_status=live_status,
                    adapter_name=adapter.adapter_name,
                    provider=adapter.provider.name,
                    model_version=adapter.model_version,
                    provider_settings=adapter.settings,
                    image_readiness=case.image_readiness,
                    permission_source=case.permission_source,
                    license_url=case.license_url,
                    consent_verified=case.consent_verified,
                    person_sha256=None,
                    person_dimensions=None,
                    garment_sha256=None,
                    garment_dimensions=None,
                    status=reported_status,
                    duration_ms=duration_ms,
                    provider_inference_ms=None,
                    prediction_id=err.prediction_id,
                    credits_used="0",
                    estimated_cost_usd=0.0,
                    person_orig_path=None,
                    garment_orig_path=None,
                    preprocessed_person_path=None,
                    raw_output_path=None,
                    raw_unpadded_path=None,
                    mask_output_path=None,
                    output_path=None,
                    comparison_strip_path=None,
                    error_category=err.category,
                    error_message=err.message,
                    provider_support_status=support_status,
                    missing_inputs=missing_inputs,
                )
            )
        except Exception as exc:
            duration_ms = int(time.time() * 1000) - start_ms
            results.append(
                EvalResult(
                    run_id=active_run_id,
                    timestamp_utc=timestamp_utc,
                    case_id=case.case_id,
                    title=case.title,
                    domain=domain,
                    category=case.category,
                    subcategory=subcat,
                    stress_group=case.stress_group,
                    target_body_region=target_region,
                    required_landmarks=req_landmarks,
                    routing_strategy=routing_strat,
                    live_validation_status=live_status,
                    adapter_name=adapter.adapter_name,
                    provider=adapter.provider.name,
                    model_version=adapter.model_version,
                    provider_settings=adapter.settings,
                    image_readiness=case.image_readiness,
                    permission_source=case.permission_source,
                    license_url=case.license_url,
                    consent_verified=case.consent_verified,
                    person_sha256=None,
                    person_dimensions=None,
                    garment_sha256=None,
                    garment_dimensions=None,
                    status="SKIPPED_OR_ERROR",
                    duration_ms=duration_ms,
                    provider_inference_ms=None,
                    prediction_id=None,
                    credits_used="0",
                    estimated_cost_usd=0.0,
                    person_orig_path=None,
                    garment_orig_path=None,
                    preprocessed_person_path=None,
                    raw_output_path=None,
                    raw_unpadded_path=None,
                    mask_output_path=None,
                    output_path=None,
                    comparison_strip_path=None,
                    error_category=type(exc).__name__,
                    error_message=str(exc),
                    provider_support_status=support_status,
                    missing_inputs=missing_inputs,
                )
            )

    return results


def generate_markdown_report(
    run_id: str,
    results: list[EvalResult],
    report_path: Path,
) -> None:
    """
    Write a reproducible Markdown evaluation report containing run metadata,
    artifact paths (raw vs. composited), and the 5-dimension 1–5 human scoring rubric sheet.
    """
    completed = [r for r in results if r.status == "COMPLETED"]
    avg_ms = int(sum(r.duration_ms for r in results) / len(results)) if results else 0
    total_cost = sum(r.estimated_cost_usd for r in results)

    lines: list[str] = [
        f"# WearMe Virtual Try-On Quality Evaluation Report (`{run_id}`)",
        "",
        f"- **Generated UTC**: `{datetime.now(timezone.utc).isoformat()}`",
        f"- **Total Cases**: `{len(results)}` (`{len(completed)}` completed)",
        f"- **Average Latency**: `{avg_ms} ms`",
        f"- **Estimated Run Cost**: `${total_cost:.4f} USD`",
        "",
        "## 1. Human Quality Scoring Rubric (1–5 Scale)",
        "",
        "> **Methodological Note**: Product fidelity, placement/fit, identity/anatomy preservation, occlusion/realism,",
        "> and robustness across lighting/pose/image quality require **human visual inspection** of the generated",
        "> comparison strips (`07_comparison_strip.jpg`) comparing `04_provider_raw_output` against `06_final_composited`.",
        "> These scores cannot be fully automated or treated as purely objective metrics.",
        "",
        "| Dimension | 1 (Severe Failure) | 3 (Acceptable) | 5 (Production Grade) |",
        "| :--- | :--- | :--- | :--- |",
        "| **1. Product Fidelity (1–5)** | Wrong product/color; logos, facets, or frames obliterated | Overall shape/color match; fine logos, chain links, or stitching softened | Exact color, pattern, logo, material sheen, and structural geometry |",
        "| **2. Placement & Fit (1–5)** | Placed on wrong body region or floats like a flat sticker | Correct target region; minor alignment or scale offset | Accurate 3D landmark alignment, natural drape/fit, correct perspective scale |",
        "| **3. Identity & Anatomy Preservation (1–5)** | Face, hands, feet, skin tone, or background altered/stretched | Identity intact; minor boundary seam halo at neck/wrist/ankle | 100% original face, hair, body proportions, skin tone, and unmasked scene |",
        "| **4. Occlusion & Realism (1–5)** | Mangled fingers/hair/ears or ghost clothing/straps | Minor softness where hair, hands, cuffs, or hems overlap the item | Sharp foreground/background occlusion around hair, fingers, collars, and cuffs |",
        "| **5. Lighting, Pose & Quality Robustness (1–5)** | Severe color cast mismatch or breakdown on angled poses | Reasonable relighting; slight flatness under directional shadows | Coherent contact shadows, specular highlights, and stability across poses |",
        "",
        "## 2. Per-Case Execution Telemetry & Human Scoring Sheet",
        "",
        "| Case ID | Domain / Subcategory | Adapter / Model | Region | Status | Latency (ms) | Est. Cost | Raw | Final | Strip | Fidelity | Fit | Identity | Occlusion | Robustness | Notes |",
        "| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |",
    ]

    for r in results:
        raw_link = f"`{Path(r.raw_output_path).name}`" if r.raw_output_path else "-"
        final_link = f"`{Path(r.output_path).name}`" if r.output_path else "-"
        strip_link = f"`{Path(r.comparison_strip_path).name}`" if r.comparison_strip_path else "-"
        note = r.error_message or ""
        lines.append(
            f"| `{r.case_id}` | `{r.domain}/{r.subcategory}` | `{r.adapter_name}` (`{r.model_version}`) | "
            f"`{r.target_body_region}` | `{r.status}` | {r.duration_ms} | ${r.estimated_cost_usd:.4f} | "
            f"{raw_link} | {final_link} | {strip_link} | ___/5 | ___/5 | ___/5 | ___/5 | ___/5 | {note} |"
        )

    lines.append("")
    report_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="WearMe Multi-Category Wearable VTON Benchmark Harness")
    provider_choices = [
        "mock",
        "necklace-poc",
        "huggingface",
        "idm-vton",
        "fashn-api",
        "fashn-v1.6",
        "fashn-tryon-max",
    ]
    parser.add_argument(
        "--provider",
        choices=provider_choices,
        default=os.environ.get("AI_PROVIDER", "mock"),
        help="Primary provider adapter to evaluate (default: mock)",
    )
    parser.add_argument(
        "--adapter",
        choices=provider_choices,
        default=None,
        help="Alias for --provider",
    )
    parser.add_argument(
        "--enable-necklace-poc",
        action="store_true",
        help="Enable the experimental landmark_jewellery_neck PoC processor for NECKLACE and PENDANT",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("FASHN_MODEL_NAME", "tryon-v1.6"),
        help="FASHN model name when using fashn-api (tryon-v1.6 or tryon-max)",
    )
    parser.add_argument(
        "--include-tryon-max",
        action="store_true",
        help="Optional Stage-2 benchmark: also run FASHN tryon-max on the selected cases",
    )
    parser.add_argument(
        "--manifest",
        type=str,
        default=None,
        help="Path to JSON manifest (v1 24-case, v2.0 120-case, or v2.1 20-case pilot manifest)",
    )
    parser.add_argument(
        "--domain",
        type=str,
        default=None,
        help="Optional comma-separated wearable domains to filter (e.g. clothing,jewellery,eyewear)",
    )
    parser.add_argument(
        "--subcategory",
        type=str,
        default=None,
        help="Optional comma-separated subcategories to filter (e.g. TSHIRT,SUNGLASSES,WATCH)",
    )
    parser.add_argument(
        "--cases",
        type=str,
        default=None,
        help="Optional comma-separated list of case IDs to run (e.g. TC-01,TC-05)",
    )
    parser.add_argument(
        "--max-cases",
        type=int,
        default=None,
        help="Optional cap on number of cases to run",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate manifest readiness, permissions, and category routing without running inference (0 GPU / $0 cost)",
    )
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Required safety flag before calling live GPU (huggingface) or paid API (fashn) providers",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(REPO_ROOT / "uploads" / "eval_runs"),
        help="Directory to write generated images, comparison strips, and evaluation reports",
    )
    args = parser.parse_args()
    selected_provider = args.adapter or args.provider

    if selected_provider not in ("mock", "necklace-poc") and not args.confirm_live and not args.dry_run:
        print(
            f"BLOCKED: Provider '{selected_provider}' consumes live GPU quota or paid API credits. "
            "Pass --confirm-live explicitly when you are ready to run live inference, or use --dry-run.",
            file=sys.stderr,
        )
        return 2

    cases = DEFAULT_24_CASES
    if args.manifest:
        cases, manifest_meta = load_manifest_cases(Path(args.manifest))
        print(
            f"Loaded manifest: schema_version={manifest_meta['schema_version']} "
            f"dataset_status={manifest_meta['dataset_status']} "
            f"ready_cases={manifest_meta['ready_case_count']}/{manifest_meta['total_cases']}"
        )

    if args.domain:
        wanted_domains = {d.strip().lower() for d in args.domain.split(",") if d.strip()}
        cases = [c for c in cases if c.domain.lower() in wanted_domains]

    if args.subcategory:
        wanted_subcats = {s.strip().upper() for s in args.subcategory.split(",") if s.strip()}
        cases = [c for c in cases if c.effective_subcategory in wanted_subcats]

    if args.cases:
        wanted = {c.strip().upper() for c in args.cases.split(",") if c.strip()}
        cases = [c for c in cases if c.case_id.upper() in wanted]

    if args.max_cases is not None and args.max_cases > 0:
        cases = cases[: args.max_cases]

    try:
        adapters: list[BenchmarkAdapter] = [
            build_adapter_for_provider(
                selected_provider,
                fashn_model=args.model,
                allow_uncredentialed_init=args.dry_run,
                enable_necklace_poc=args.enable_necklace_poc,
            )
        ]
        if args.include_tryon_max:
            adapters.append(
                build_adapter_for_provider(
                    "fashn-tryon-max",
                    fashn_model="tryon-max",
                    allow_uncredentialed_init=args.dry_run,
                    enable_necklace_poc=args.enable_necklace_poc,
                )
            )
    except ValueError as err:
        print(str(err), file=sys.stderr)
        return 2

    out_dir = Path(args.output_dir)
    run_timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    all_results: list[EvalResult] = []

    for adapter in adapters:
        run_id = f"{run_timestamp}_{adapter.adapter_name}"
        adapter_results = asyncio.run(
            run_evaluation(
                adapter,
                cases,
                out_dir,
                run_id=run_id,
                dry_run=args.dry_run,
            )
        )
        all_results.extend(adapter_results)

        summary_path = out_dir / f"eval_summary_{adapter.provider.name}.json"
        summary_path.write_text(
            json.dumps([asdict(r) for r in adapter_results], indent=2),
            encoding="utf-8",
        )

    report_id = f"{run_timestamp}_benchmark"
    results_json_path = out_dir / "results.json"
    report_md_path = out_dir / "report.md"
    results_json_path.write_text(
        json.dumps([asdict(r) for r in all_results], indent=2),
        encoding="utf-8",
    )
    generate_markdown_report(report_id, all_results, report_md_path)

    completed = sum(1 for r in all_results if r.status == "COMPLETED")
    avg_ms = (
        int(sum(r.duration_ms for r in all_results) / len(all_results))
        if all_results
        else 0
    )
    print(
        f"Evaluation complete: adapters={[a.adapter_name for a in adapters]} "
        f"completed={completed}/{len(all_results)} avg_duration_ms={avg_ms} "
        f"results={results_json_path} report={report_md_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
