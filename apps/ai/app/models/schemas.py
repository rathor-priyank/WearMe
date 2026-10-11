from pydantic import BaseModel


class TryOnResponse(BaseModel):
    job_id: str
    provider: str
    inference_ms: int
    result_image_base64: str
    result_mime_type: str
    metadata: dict = {}


class HealthResponse(BaseModel):
    status: str
    provider: str

