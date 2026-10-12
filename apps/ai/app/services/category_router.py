import logging
from pathlib import Path
from typing import Any

from .base import VTONConfigError, VTONProvider, VTONValidationError
from .fashn_api_provider import FASHNApiProvider
from .huggingface_provider import HuggingFaceProvider
from .mock_provider import MockProvider
from .necklace_poc_provider import (
    SUPPORTED_NECKLACE_SUBCATEGORIES,
    NecklacePocProvider,
)
from .wearable_taxonomy import WearableSpec, resolve_wearable_spec

logger = logging.getLogger("wearme.ai.router_provider")


class CategoryRouterProvider(VTONProvider):
    """
    Category-aware routing layer for WearMe virtual try-on.

    Responsibilities:
    1. Resolves `(category, subcategory)` to its canonical `WearableSpec` across all
       8 wearable domains (clothing, jewellery, eyewear, wristwear, bags, footwear,
       headwear, and other accessories).
    2. Prevents forcing non-upper-body categories through `yisol/IDM-VTON`
       (`HuggingFaceProvider`), which only masks and inpaints upper-body garments.
    3. Routes `NECKLACE` and `PENDANT` to `NecklacePocProvider` (`landmark_jewellery_neck`)
       ONLY when `enable_necklace_poc=True` (or an enabled `NecklacePocProvider` is attached).
    4. Routes extended clothing (`bottoms`, `one-pieces`) to `FASHNApiProvider` when
       configured, while marking live validation status honestly (`verified_live_idm_vton`
       vs. `experimental_poc_local_unverified_live` vs. `supported_fashn_api_unverified_live`
       vs. `requires_specialized_model_unverified_live`).
    5. Never silently falls back to `MockProvider` when a real provider is active.
    """

    def __init__(
        self,
        primary_provider: VTONProvider,
        allow_extended_mock: bool = False,
        enable_necklace_poc: bool = False,
        necklace_poc_provider: NecklacePocProvider | None = None,
    ) -> None:
        self._primary = primary_provider
        self._allow_extended_mock = allow_extended_mock
        if isinstance(primary_provider, NecklacePocProvider):
            self._necklace_poc: NecklacePocProvider | None = primary_provider
            self._enable_necklace_poc = primary_provider.enabled
        elif necklace_poc_provider is not None:
            self._necklace_poc = necklace_poc_provider
            self._enable_necklace_poc = necklace_poc_provider.enabled
        elif enable_necklace_poc:
            self._necklace_poc = NecklacePocProvider(enabled=True)
            self._enable_necklace_poc = True
        else:
            self._necklace_poc = None
            self._enable_necklace_poc = False

    @property
    def name(self) -> str:
        return self._primary.name

    @property
    def necklace_poc_enabled(self) -> bool:
        return self._enable_necklace_poc

    def classify_support(
        self,
        category: str,
        subcategory: str | None = None,
    ) -> tuple[WearableSpec | None, str, str | None]:
        """
        Classify whether the configured primary provider (or experimental PoC processor)
        has a validated/supported route for `(category, subcategory)`.

        Returns:
            `(spec, support_status, selected_route)` where `support_status` is one of:
            - `"supported"`: Category is supported by the active clothing provider.
            - `"experimental_poc"`: Category (`NECKLACE` or `PENDANT`) is routed to the
              experimental `landmark_jewellery_neck` PoC processor (`enable_necklace_poc=True`).
            - `"requires_specialized_model"`: Category belongs to a wearable domain
              that has no validated live provider yet (`live_validation_status ==
              "requires_specialized_model_unverified_live"`).
            - `"unsupported"`: Category is unknown or incompatible with the active
              provider (e.g. lower-body clothing on upper-body-only IDM-VTON).
        """
        spec = resolve_wearable_spec(category, subcategory)
        if spec is None:
            return None, "unsupported", None

        prov_name = self._primary.name

        # 0. Necklace / Pendant experimental PoC route when enabled
        if spec.subcategory in SUPPORTED_NECKLACE_SUBCATEGORIES and self._enable_necklace_poc:
            return spec, "experimental_poc", "landmark_jewellery_neck"

        # Standalone NecklacePocProvider when disabled or queried for non-necklace categories
        if isinstance(self._primary, NecklacePocProvider):
            if spec.subcategory in SUPPORTED_NECKLACE_SUBCATEGORIES:
                return spec, "requires_specialized_model", None
            if spec.live_validation_status == "requires_specialized_model_unverified_live":
                return spec, "requires_specialized_model", None
            return spec, "unsupported", None

        # 1. MockProvider: only upper-body clothing by default so non-validated categories
        # are never routed to mock output as though they were real.
        if isinstance(self._primary, MockProvider):
            if self._allow_extended_mock:
                return spec, "supported", "mock_target_region_overlay"
            if spec.idm_vton_prompt is not None:
                return spec, "supported", "mock_target_region_overlay"
            if spec.live_validation_status == "requires_specialized_model_unverified_live":
                return spec, "requires_specialized_model", None
            return spec, "unsupported", None

        # 2. HuggingFaceProvider (yisol/IDM-VTON): strictly upper-body clothing only
        if isinstance(self._primary, HuggingFaceProvider) or prov_name == "huggingface":
            if spec.idm_vton_prompt is not None:
                return spec, "supported", "idm_vton_upper_body"
            if spec.live_validation_status == "requires_specialized_model_unverified_live":
                return spec, "requires_specialized_model", None
            return spec, "unsupported", None

        # 3. FASHNApiProvider: supports tops, bottoms, and one-pieces on tryon-v1.6
        if isinstance(self._primary, FASHNApiProvider) or prov_name == "fashn-api":
            model_name = getattr(self._primary, "_model_name", "tryon-v1.6")
            if spec.fashn_v16_category is not None and spec.subcategory != "SAREE":
                return spec, "supported", f"fashn_{model_name}_{spec.fashn_v16_category}"
            if model_name == "tryon-max" and spec.domain == "clothing" and spec.subcategory != "SAREE":
                return spec, "supported", "fashn_tryon_max_product"
            if spec.live_validation_status == "requires_specialized_model_unverified_live":
                return spec, "requires_specialized_model", None
            return spec, "unsupported", None

        if spec.live_validation_status == "requires_specialized_model_unverified_live":
            return spec, "requires_specialized_model", None
        return spec, "supported", spec.routing_strategy

    def resolve_route(
        self,
        category: str,
        subcategory: str | None = None,
    ) -> tuple[WearableSpec, str]:
        """
        Determine the `WearableSpec` and whether the configured primary provider
        (or experimental Necklace PoC processor) can execute the request.

        Raises `VTONValidationError` or `VTONConfigError` if:
        - The category/subcategory is unknown, OR
        - The active provider does not support the category's required routing strategy.
        """
        spec = resolve_wearable_spec(category, subcategory)
        if spec is None:
            raise VTONValidationError(
                f"Unsupported garment or wearable category '{subcategory or category}'.",
                category="unsupported",
            )

        prov_name = self._primary.name

        # 0. Necklace / Pendant experimental PoC route when enabled
        if spec.subcategory in SUPPORTED_NECKLACE_SUBCATEGORIES and self._enable_necklace_poc:
            return spec, "landmark_jewellery_neck"

        # Standalone NecklacePocProvider handling
        if isinstance(self._primary, NecklacePocProvider):
            if spec.subcategory in SUPPORTED_NECKLACE_SUBCATEGORIES and not self._primary.enabled:
                raise VTONConfigError(
                    "Necklace/Pendant PoC processor ('landmark_jewellery_neck') is disabled. "
                    "Set ENABLE_NECKLACE_POC=true to enable experimental necklace/pendant try-on."
                )
            err_cat = (
                "requires_specialized_model"
                if spec.live_validation_status == "requires_specialized_model_unverified_live"
                else "unsupported_category_for_provider"
            )
            raise VTONValidationError(
                f"Category '{spec.subcategory}' (domain='{spec.domain}', "
                f"strategy='{spec.routing_strategy}') is not supported by NecklacePocProvider "
                f"(which only handles {sorted(SUPPORTED_NECKLACE_SUBCATEGORIES)}).",
                category=err_cat,
            )

        # 1. MockProvider: supports upper-body by default, or all 38 subcategories when allow_extended_mock=True
        if isinstance(self._primary, MockProvider):
            if not self._allow_extended_mock and not spec.idm_vton_prompt:
                err_cat = (
                    "requires_specialized_model"
                    if spec.live_validation_status == "requires_specialized_model_unverified_live"
                    else "unsupported_category_for_provider"
                )
                raise VTONValidationError(
                    f"Category '{spec.subcategory}' (domain='{spec.domain}', "
                    f"strategy='{spec.routing_strategy}') has no validated live provider "
                    f"({spec.live_validation_status}) and cannot be routed to MockProvider as though it were real. "
                    "Supported upper-body categories: HOODIE, JACKET, SHIRT, SWEATER, TOP, TSHIRT.",
                    category=err_cat,
                )
            return spec, "mock_target_region_overlay"

        # 2. HuggingFaceProvider (yisol/IDM-VTON): strictly upper-body clothing only
        if isinstance(self._primary, HuggingFaceProvider) or prov_name == "huggingface":
            if spec.idm_vton_prompt is None:
                raise VTONValidationError(
                    f"Category '{spec.subcategory}' (domain='{spec.domain}', "
                    f"target_region='{spec.target_body_region}') cannot be routed to "
                    f"HuggingFaceProvider (yisol/IDM-VTON). IDM-VTON '/tryon' is strictly an "
                    f"upper-body garment diffusion model and does not support '{spec.routing_strategy}' "
                    f"(required landmarks: {', '.join(spec.required_landmarks)}).",
                    category="unsupported_category_for_provider",
                )
            return spec, "idm_vton_upper_body"

        # 3. FASHNApiProvider: supports tops, bottoms, and one-pieces on tryon-v1.6
        if isinstance(self._primary, FASHNApiProvider) or prov_name == "fashn-api":
            model_name = getattr(self._primary, "_model_name", "tryon-v1.6")
            if spec.fashn_v16_category is not None and spec.subcategory != "SAREE":
                return spec, f"fashn_{model_name}_{spec.fashn_v16_category}"
            if model_name == "tryon-max" and spec.domain == "clothing" and spec.subcategory != "SAREE":
                return spec, "fashn_tryon_max_product"
            raise VTONValidationError(
                f"Category '{spec.subcategory}' (domain='{spec.domain}', "
                f"strategy='{spec.routing_strategy}') is not supported by FASHN '{model_name}' "
                f"without a dedicated '{spec.target_body_region}' landmark processor "
                f"(required landmarks: {', '.join(spec.required_landmarks)}).",
                category="unsupported_category_for_provider",
            )

        return spec, spec.routing_strategy

    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
        subcategory: str | None = None,
        debug_artifact_dir: Path | str | None = None,
    ) -> tuple[bytes, str, dict[str, Any]]:
        spec, selected_route = self.resolve_route(category, subcategory)

        if selected_route == "landmark_jewellery_neck" and self._necklace_poc is not None:
            out_bytes, mime, meta = await self._necklace_poc.process(
                job_id=job_id,
                person_image_bytes=person_image_bytes,
                garment_image_bytes=garment_image_bytes,
                category=category,
                subcategory=spec.subcategory,
                debug_artifact_dir=debug_artifact_dir,
            )
            enriched_poc_meta: dict[str, Any] = {
                **meta,
                "domain": spec.domain,
                "category": category,
                "subcategory": spec.subcategory,
                "target_body_region": spec.target_body_region,
                "required_landmarks": list(spec.required_landmarks),
                "routing_strategy": spec.routing_strategy,
                "selected_route": selected_route,
                "is_experimental_poc": True,
                "live_validation_status": "experimental_poc_local_unverified_live",
            }
            return out_bytes, mime, enriched_poc_meta

        if isinstance(self._primary, MockProvider):
            if self._allow_extended_mock and not self._primary._allow_extended:
                ext_mock = MockProvider(allow_extended_categories=True)
                out_bytes, mime, meta = await ext_mock.process(
                    job_id=job_id,
                    person_image_bytes=person_image_bytes,
                    garment_image_bytes=garment_image_bytes,
                    category=spec.subcategory,
                    subcategory=subcategory,
                )
            else:
                out_bytes, mime, meta = await self._primary.process(
                    job_id=job_id,
                    person_image_bytes=person_image_bytes,
                    garment_image_bytes=garment_image_bytes,
                    category=spec.subcategory,
                    subcategory=subcategory,
                )
        elif isinstance(self._primary, HuggingFaceProvider):
            out_bytes, mime, meta = await self._primary.process(
                job_id=job_id,
                person_image_bytes=person_image_bytes,
                garment_image_bytes=garment_image_bytes,
                category=spec.subcategory,
                debug_artifact_dir=debug_artifact_dir,
            )
        else:
            out_bytes, mime, meta = await self._primary.process(
                job_id=job_id,
                person_image_bytes=person_image_bytes,
                garment_image_bytes=garment_image_bytes,
                category=spec.subcategory,
            )

        enriched_meta: dict[str, Any] = {
            **meta,
            "domain": spec.domain,
            "category": category,
            "subcategory": spec.subcategory,
            "target_body_region": spec.target_body_region,
            "required_landmarks": list(spec.required_landmarks),
            "routing_strategy": spec.routing_strategy,
            "selected_route": selected_route,
            "live_validation_status": spec.live_validation_status,
        }
        return out_bytes, mime, enriched_meta

    async def health_check(self) -> bool:
        return await self._primary.health_check()

