import base64
import logging
import time
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from ..models.schemas import TryOnResponse
from ..services.base import VTONError, VTONProvider

logger = logging.getLogger("wearme.ai.router")


def get_router(provider: VTONProvider) -> APIRouter:
    """
    Returns a fresh APIRouter with the configured VTONProvider injected.
    """
    router = APIRouter(prefix="/try-on", tags=["try-on"])

    @router.post("", response_model=TryOnResponse)
    async def process_try_on(
        job_id: str = Form(...),
        category: str = Form(...),
        person_image: UploadFile = File(...),
        garment_image: UploadFile = File(...),
    ) -> TryOnResponse:
        """
        Process a virtual try-on request through the active VTONProvider.
        Returns the generated image as a base64-encoded string with metadata.
        """
        start = int(time.time() * 1000)

        person_bytes = await person_image.read()
        garment_bytes = await garment_image.read()

        if not person_bytes:
            raise HTTPException(status_code=400, detail="person_image is empty.")
        if not garment_bytes:
            raise HTTPException(status_code=400, detail="garment_image is empty.")

        try:
            result_bytes, result_mime, metadata = await provider.process(
                job_id=job_id,
                person_image_bytes=person_bytes,
                garment_image_bytes=garment_bytes,
                category=category,
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
        logger.info(
            "try_on succeeded job_id=%s provider=%s duration_ms=%d",
            job_id,
            provider.name,
            inference_ms,
        )

        return TryOnResponse(
            job_id=job_id,
            provider=provider.name,
            inference_ms=inference_ms,
            result_image_base64=base64.b64encode(result_bytes).decode("utf-8"),
            result_mime_type=result_mime,
            metadata=metadata,
        )

    @router.get("/health")
    async def health() -> dict:
        ok = await provider.health_check()
        response: dict = {
            "status": "ok" if ok else "error",
            "provider": provider.name,
        }
        if not ok and provider.name == "fashn-api":
            response["detail"] = (
                "AI_API_KEY is not configured. Set AI_API_KEY when AI_PROVIDER=fashn-api."
            )
        return response

    return router
