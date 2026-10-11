from fastapi import FastAPI
from .config import Settings, settings
from .routers.try_on import get_router
from .services.base import VTONProvider
from .services.mock_provider import MockProvider


def create_provider(cfg: Settings | None = None) -> VTONProvider:
    """Select and instantiate the configured VTONProvider."""
    active_cfg = cfg or settings
    provider_name = (active_cfg.ai_provider or "mock").strip().lower()

    match provider_name:
        case "mock":
            return MockProvider()
        case "fashn-api":
            from .services.fashn_api_provider import FASHNApiProvider

            return FASHNApiProvider(
                api_key=active_cfg.ai_api_key,
                timeout_seconds=active_cfg.effective_timeout_seconds,
                model_name=active_cfg.fashn_model_name,
                mode=active_cfg.fashn_mode,
                return_base64=active_cfg.fashn_return_base64,
                garment_photo_type=active_cfg.fashn_garment_photo_type,
                moderation_level=active_cfg.fashn_moderation_level,
            )
        case "huggingface":
            from .services.huggingface_provider import HuggingFaceProvider

            token = active_cfg.hf_token or active_cfg.ai_api_key
            return HuggingFaceProvider(
                hf_token=token,
                space_id=active_cfg.hf_space_id,
                timeout_seconds=active_cfg.effective_timeout_seconds,
                denoise_steps=active_cfg.hf_denoise_steps,
            )
        case _:
            raise ValueError(
                f"Unknown AI_PROVIDER '{active_cfg.ai_provider}'. "
                "Supported values: 'mock', 'fashn-api', 'huggingface'."
            )


def create_app(cfg: Settings | None = None, provider: VTONProvider | None = None) -> FastAPI:
    active_provider = provider or create_provider(cfg)

    app = FastAPI(
        title="WearMe AI Service",
        description="Virtual try-on inference service — provider-agnostic (mock | fashn-api | huggingface)",
        version="1.2.0",
    )

    app.include_router(get_router(active_provider))

    @app.get("/health")
    async def root_health() -> dict:
        ok = await active_provider.health_check()
        response: dict = {
            "status": "ok" if ok else "error",
            "provider": active_provider.name,
        }
        if not ok and active_provider.name == "fashn-api":
            response["detail"] = (
                "AI_API_KEY is not configured. Set AI_API_KEY when AI_PROVIDER=fashn-api."
            )
        return response

    return app


app = create_app()
