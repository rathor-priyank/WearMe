from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ai_provider: str = "mock"
    ai_api_key: str = ""
    ai_request_timeout_seconds: int = 120
    ai_timeout_ms: int | None = None

    # Option 1: Official FASHN API v1 configuration (AI_PROVIDER=fashn-api)
    fashn_model_name: str = "tryon-v1.6"
    fashn_mode: str = "balanced"
    fashn_return_base64: bool = True
    fashn_garment_photo_type: str = "auto"
    fashn_moderation_level: str = "permissive"

    # Option 2: Free Hugging Face Spaces VTON configuration (AI_PROVIDER=huggingface)
    hf_token: str = ""
    hf_space_id: str = "yisol/IDM-VTON"
    hf_denoise_steps: int = 30

    # Experimental PoC processor flag for NECKLACE and PENDANT (default: False)
    enable_necklace_poc: bool = False

    host: str = "0.0.0.0"
    port: int = 8001

    model_config = {
        "env_file": (".env", "../../.env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    @property
    def effective_timeout_seconds(self) -> float:
        """Resolve timeout in seconds from AI_REQUEST_TIMEOUT_SECONDS or legacy AI_TIMEOUT_MS."""
        if self.ai_request_timeout_seconds and self.ai_request_timeout_seconds != 120:
            return float(self.ai_request_timeout_seconds)
        if self.ai_timeout_ms is not None and self.ai_timeout_ms > 0:
            return max(float(self.ai_timeout_ms) / 1000.0, float(self.ai_request_timeout_seconds))
        return float(self.ai_request_timeout_seconds)


settings = Settings()
