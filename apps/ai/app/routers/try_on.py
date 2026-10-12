import base64
from dataclasses import asdict
import logging
import time
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from ..models.schemas import TryOnResponse
from ..services.base import VTONError, VTONProvider
from ..services.category_router import CategoryRouterProvider
from ..services.necklace_poc_provider import (
    SUPPORTED_NECKLACE_SUBCATEGORIES,
    NecklacePocProvider,
)
from ..services.wearable_taxonomy import WEARABLE_SPECS

logger = logging.getLogger("wearme.ai.router")


def get_router(
    provider: VTONProvider,
    enable_necklace_poc: bool = False,
) -> APIRouter:
    """
    Returns a fresh APIRouter with the configured VTONProvider injected.
    """
    router = APIRouter(prefix="/try-on", tags=["try-on"])
    cat_router = (
        provider
        if isinstance(provider, CategoryRouterProvider)
        else CategoryRouterProvider(provider, enable_necklace_poc=enable_necklace_poc)
    )

    @router.post("", response_model=TryOnResponse)
    async def process_try_on(
        job_id: str = Form(...),
        category: str = Form(...),
        subcategory: str | None = Form(default=None),
        person_image: UploadFile = File(...),
        garment_image: UploadFile = File(...),
    ) -> TryOnResponse:
        """
        Process a virtual try-on request through the active VTONProvider.
        Returns the generated image as a base64-encoded string with metadata.
        """
        start = int(time.time() * 1000)
        max_read = 10 * 1024 * 1024 + 1  # 10 MB + 1 byte cap to prevent unbounded memory buffering

        person_bytes = await person_image.read(max_read)
        garment_bytes = await garment_image.read(max_read)

        if not person_bytes:
            raise HTTPException(status_code=400, detail="person_image is empty.")
        if not garment_bytes:
            raise HTTPException(status_code=400, detail="garment_image is empty.")

        effective_cat = (subcategory or category).strip()
        norm_effective = effective_cat.upper()

        use_category_router = (
            isinstance(provider, (CategoryRouterProvider, NecklacePocProvider))
            or subcategory is not None
            or norm_effective in SUPPORTED_NECKLACE_SUBCATEGORIES
            or category.strip().upper() == "ACCESSORY"
        )

        try:
            if use_category_router:
                result_bytes, result_mime, metadata = await cat_router.process(
                    job_id=job_id,
                    person_image_bytes=person_bytes,
                    garment_image_bytes=garment_bytes,
                    category=category,
                    subcategory=subcategory or effective_cat,
                )
            else:
                result_bytes, result_mime, metadata = await provider.process(
                    job_id=job_id,
                    person_image_bytes=person_bytes,
                    garment_image_bytes=garment_bytes,
                    category=effective_cat,
                )
        except VTONError as err:
            duration_ms = int(time.time() * 1000) - start
            logger.warning(
                "try_on failed job_id=%s provider=%s category=%s duration_ms=%d status=%d detail=%s",
                job_id,
                provider.name,
                err.category,
                duration_ms,
                err.status_code,
                err.message,
            )
            raise HTTPException(status_code=err.status_code, detail=err.message) from err
        except Exception as exc:
            duration_ms = int(time.time() * 1000) - start
            logger.error(
                "try_on unexpected error job_id=%s provider=%s duration_ms=%d type=%s",
                job_id,
                provider.name,
                duration_ms,
                type(exc).__name__,
            )
            raise HTTPException(
                status_code=500,
                detail="Virtual try-on processing failed due to an unexpected internal error.",
            ) from exc

        inference_ms = int(time.time() * 1000) - start
        resolved_provider = str(metadata.get("provider") or provider.name)
        logger.info(
            "try_on succeeded job_id=%s provider=%s duration_ms=%d",
            job_id,
            resolved_provider,
            inference_ms,
        )

        return TryOnResponse(
            job_id=job_id,
            provider=resolved_provider,
            inference_ms=inference_ms,
            result_image_base64=base64.b64encode(result_bytes).decode("utf-8"),
            result_mime_type=result_mime,
            metadata=metadata,
        )

    @router.get("/categories")
    async def list_categories() -> dict:
        """
        Return the full wearable category taxonomy, required anatomical landmarks,
        routing strategy, per-category provider support classification, and honest
        live validation status.
        """
        items = []
        for spec in WEARABLE_SPECS.values():
            _, support_status, selected_route = cat_router.classify_support(
                spec.domain, spec.subcategory
            )
            spec_dict = asdict(spec)
            spec_dict["provider_support_status"] = support_status
            spec_dict["selected_route"] = selected_route
            if support_status == "experimental_poc":
                spec_dict["live_validation_status"] = "experimental_poc_local_unverified_live"
            items.append(spec_dict)

        return {
            "active_provider": provider.name,
            "necklace_poc_enabled": cat_router.necklace_poc_enabled,
            "categories": items,
        }

    @router.get("/health")
    async def health() -> dict:
        ok = await provider.health_check()
        response: dict = {
            "status": "ok" if ok else "error",
            "provider": provider.name,
            "necklace_poc_enabled": cat_router.necklace_poc_enabled,
        }
        if not ok and provider.name == "fashn-api":
            response["detail"] = (
                "AI_API_KEY is not configured. Set AI_API_KEY when AI_PROVIDER=fashn-api."
            )
        return response

    return router
