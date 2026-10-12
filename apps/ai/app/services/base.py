from abc import ABC, abstractmethod


class VTONError(Exception):
    """Base exception for all virtual try-on provider errors with user-safe messaging."""

    def __init__(
        self,
        message: str,
        *,
        category: str = "provider_error",
        status_code: int = 502,
        retryable: bool = False,
        prediction_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.category = category
        self.status_code = status_code
        self.retryable = retryable
        self.prediction_id = prediction_id


class VTONConfigError(VTONError):
    """Raised when provider credentials or required settings are missing or invalid."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            category="configuration_error",
            status_code=503,
            retryable=False,
        )


class VTONValidationError(VTONError):
    """Raised when inputs fail validation, pose detection, or content moderation."""

    def __init__(
        self,
        message: str,
        *,
        category: str = "validation_error",
        prediction_id: str | None = None,
    ) -> None:
        super().__init__(
            message,
            category=category,
            status_code=400,
            retryable=False,
            prediction_id=prediction_id,
        )


class VTONAuthError(VTONError):
    """Raised when the upstream AI provider rejects credentials (HTTP 401/403)."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            category="auth_error",
            status_code=502,
            retryable=False,
        )


class VTONQuotaError(VTONError):
    """Raised when rate limits, concurrency limits, or credit quotas are exceeded (HTTP 429)."""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(
            message,
            category="quota_or_rate_limit",
            status_code=429,
            retryable=retryable,
        )


class VTONTimeoutError(VTONError):
    """Raised when provider execution or status polling exceeds the configured timeout."""

    def __init__(self, message: str, *, prediction_id: str | None = None) -> None:
        super().__init__(
            message,
            category="timeout",
            status_code=504,
            retryable=True,
            prediction_id=prediction_id,
        )


class VTONProviderError(VTONError):
    """Raised on upstream 5xx, pipeline errors, malformed payloads, or untrusted output URLs."""

    def __init__(
        self,
        message: str,
        *,
        category: str = "provider_error",
        retryable: bool = False,
        prediction_id: str | None = None,
    ) -> None:
        super().__init__(
            message,
            category=category,
            status_code=502,
            retryable=retryable,
            prediction_id=prediction_id,
        )


class VTONProvider(ABC):
    """
    Abstract base class for all virtual try-on providers.

    Supported implementations:
    - MockProvider ('mock'): Deterministic composite for local development & testing
    - FASHNApiProvider ('fashn-api'): Real virtual try-on inference via official FASHN API v1
    - HuggingFaceProvider ('huggingface'): Non-commercial virtual try-on via Hugging Face Spaces (yisol/IDM-VTON)
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider identifier."""
        ...

    @abstractmethod
    async def process(
        self,
        job_id: str,
        person_image_bytes: bytes,
        garment_image_bytes: bytes,
        category: str,
    ) -> tuple[bytes, str, dict]:
        """
        Process a try-on request.

        Returns:
            (result_image_bytes, result_mime_type, metadata_dict)

        Raises:
            VTONError on failure — caller records the error and marks job FAILED.
        """
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if provider is configured and ready."""
        ...
