import base64
import io
import pytest
import httpx
from PIL import Image
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import app, create_app, create_provider
from app.services.base import (
    VTONAuthError,
    VTONConfigError,
    VTONProviderError,
    VTONQuotaError,
    VTONTimeoutError,
    VTONValidationError,
)
from app.services.fashn_api_provider import FASHNApiProvider
from app.services.image_validator import ImageValidationError, validate_and_encode_image


def _make_test_image(
    color: tuple[int, int, int] = (120, 80, 200),
    size: tuple[int, int] = (256, 384),
    fmt: str = "JPEG",
) -> bytes:
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_health_endpoint_mock():
    mock_app = create_app(cfg=Settings(ai_provider="mock"))
    transport = ASGITransport(app=mock_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["provider"] == "mock"


@pytest.mark.asyncio
async def test_try_on_endpoint_mock_success():
    person_bytes = _make_test_image((200, 180, 170), fmt="JPEG")
    garment_bytes = _make_test_image((40, 90, 180), fmt="PNG")

    mock_app = create_app(cfg=Settings(ai_provider="mock"))
    transport = ASGITransport(app=mock_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/try-on",
            data={"job_id": "test-job-123", "category": "TSHIRT"},
            files={
                "person_image": ("person.jpg", person_bytes, "image/jpeg"),
                "garment_image": ("garment.png", garment_bytes, "image/png"),
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["job_id"] == "test-job-123"
        assert body["provider"] == "mock"
        assert body["result_mime_type"] == "image/jpeg"
        assert body["metadata"]["is_mock"] is True
        decoded = base64.b64decode(body["result_image_base64"])
        out_img = Image.open(io.BytesIO(decoded))
        assert out_img.size == (256, 384)


def test_image_validator_formats_and_errors():
    # Valid JPEG, PNG, WEBP
    for fmt, expected_mime in [
        ("JPEG", "image/jpeg"),
        ("PNG", "image/png"),
        ("WEBP", "image/webp"),
    ]:
        raw = _make_test_image(fmt=fmt)
        validated = validate_and_encode_image(raw, label="test_img")
        assert validated.mime_type == expected_mime
        assert validated.data_uri.startswith(f"data:{expected_mime};base64,")

    # Reject corrupt/non-image data
    with pytest.raises(ImageValidationError, match="unsupported or invalid file signature"):
        validate_and_encode_image(b"not an image at all", label="person_image")

    # Reject fake JPEG magic bytes with corrupt body
    with pytest.raises(ImageValidationError, match="corrupt or cannot be decoded"):
        validate_and_encode_image(b"\xff\xd8\xff\xe0" + b"0" * 50, label="person_image")

    # Reject dimensions < 64x64
    tiny = _make_test_image(size=(32, 32))
    with pytest.raises(ImageValidationError, match="too small"):
        validate_and_encode_image(tiny, label="garment_image")


@pytest.mark.asyncio
async def test_try_on_rejects_corrupt_image_and_invalid_category():
    valid_bytes = _make_test_image()
    mock_app = create_app(cfg=Settings(ai_provider="mock"))
    transport = ASGITransport(app=mock_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Corrupt image
        res_corrupt = await client.post(
            "/try-on",
            data={"job_id": "job-bad-img", "category": "TOP"},
            files={
                "person_image": ("person.jpg", b"corrupt-bytes", "image/jpeg"),
                "garment_image": ("garment.jpg", valid_bytes, "image/jpeg"),
            },
        )
        assert res_corrupt.status_code == 400
        assert "person_image" in res_corrupt.json()["detail"]

        # Unsupported category
        res_cat = await client.post(
            "/try-on",
            data={"job_id": "job-bad-cat", "category": "SAREE"},
            files={
                "person_image": ("person.jpg", valid_bytes, "image/jpeg"),
                "garment_image": ("garment.jpg", valid_bytes, "image/jpeg"),
            },
        )
        assert res_cat.status_code == 400
        assert "Unsupported garment category" in res_cat.json()["detail"]


@pytest.mark.asyncio
async def test_fashn_provider_missing_credentials_fails_clearly():
    with pytest.raises(VTONConfigError, match="AI_API_KEY is required"):
        FASHNApiProvider(api_key="", validate_on_init=True)

    cfg = Settings(ai_provider="fashn-api", ai_api_key="")
    fashn_app = create_app(cfg=cfg)
    transport = ASGITransport(app=fashn_app)

    valid_bytes = _make_test_image()
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        health_res = await client.get("/health")
        assert health_res.status_code == 200
        assert health_res.json()["status"] == "error"
        assert "AI_API_KEY" in health_res.json()["detail"]

        run_res = await client.post(
            "/try-on",
            data={"job_id": "job-no-key", "category": "SHIRT"},
            files={
                "person_image": ("person.jpg", valid_bytes, "image/jpeg"),
                "garment_image": ("garment.jpg", valid_bytes, "image/jpeg"),
            },
        )
        assert run_res.status_code == 503
        assert "AI_API_KEY is required when AI_PROVIDER=fashn-api" in run_res.json()["detail"]


@pytest.mark.asyncio
async def test_fashn_provider_v1_6_polling_and_base64_output(monkeypatch):
    person_bytes = _make_test_image((210, 190, 180), fmt="JPEG")
    garment_bytes = _make_test_image((20, 100, 200), fmt="PNG")
    expected_out_bytes = _make_test_image((80, 160, 120), fmt="JPEG")
    expected_out_uri = (
        f"data:image/jpeg;base64,{base64.b64encode(expected_out_bytes).decode('ascii')}"
    )

    captured_requests: list[httpx.Request] = []
    status_poll_count = 0

    def mock_handler(request: httpx.Request) -> httpx.Response:
        nonlocal status_poll_count
        captured_requests.append(request)

        if request.method == "POST" and str(request.url) == "https://api.fashn.ai/v1/run":
            assert request.headers.get("Authorization") == "Bearer test-secret-key"
            import json

            payload = json.loads(request.content.decode("utf-8"))
            assert payload["model_name"] == "tryon-v1.6"
            inputs = payload["inputs"]
            assert inputs["category"] == "tops"
            assert inputs["mode"] == "balanced"
            assert inputs["return_base64"] is True
            assert inputs["model_image"].startswith("data:image/jpeg;base64,")
            assert inputs["garment_image"].startswith("data:image/png;base64,")
            return httpx.Response(200, json={"id": "pred-abc-123", "error": None})

        if (
            request.method == "GET"
            and str(request.url) == "https://api.fashn.ai/v1/status/pred-abc-123"
        ):
            status_poll_count += 1
            if status_poll_count == 1:
                return httpx.Response(
                    200,
                    json={"id": "pred-abc-123", "status": "starting", "output": None, "error": None},
                )
            if status_poll_count == 2:
                return httpx.Response(
                    200,
                    json={
                        "id": "pred-abc-123",
                        "status": "processing",
                        "output": None,
                        "error": None,
                    },
                )
            return httpx.Response(
                200,
                headers={"x-fashn-credits-used": "1"},
                json={
                    "id": "pred-abc-123",
                    "status": "completed",
                    "output": [expected_out_uri],
                    "error": None,
                },
            )

        return httpx.Response(404, json={"error": "NotFound"})

    real_async_client = httpx.AsyncClient

    def patched_async_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(mock_handler)
        return real_async_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", patched_async_client)

    provider = FASHNApiProvider(
        api_key="test-secret-key",
        timeout_seconds=30.0,
        model_name="tryon-v1.6",
        mode="balanced",
        return_base64=True,
        poll_interval_sec=0.05,
    )

    out_bytes, out_mime, meta = await provider.process(
        job_id="job-real-sim",
        person_image_bytes=person_bytes,
        garment_image_bytes=garment_bytes,
        category="JACKET",
    )

    assert out_bytes == expected_out_bytes
    assert out_mime == "image/jpeg"
    assert meta["is_mock"] is False
    assert meta["prediction_id"] == "pred-abc-123"
    assert meta["model_name"] == "tryon-v1.6"
    assert meta["fashn_category"] == "tops"
    assert meta["credits_used"] == "1"
    assert status_poll_count == 3


@pytest.mark.asyncio
async def test_fashn_provider_cdn_url_and_ssrf_protection(monkeypatch):
    person_bytes = _make_test_image()
    garment_bytes = _make_test_image()
    cdn_image_bytes = _make_test_image((50, 150, 250), fmt="PNG")

    # 1. Valid allowlisted CDN host (https://cdn.fashn.ai/...) succeeds
    def valid_cdn_handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "https://api.fashn.ai/v1/run":
            return httpx.Response(200, json={"id": "pred-cdn-1", "error": None})
        if str(request.url) == "https://api.fashn.ai/v1/status/pred-cdn-1":
            return httpx.Response(
                200,
                json={
                    "id": "pred-cdn-1",
                    "status": "completed",
                    "output": ["https://cdn.fashn.ai/predictions/pred-cdn-1/output_0.png"],
                    "error": None,
                },
            )
        if str(request.url) == "https://cdn.fashn.ai/predictions/pred-cdn-1/output_0.png":
            return httpx.Response(200, content=cdn_image_bytes)
        return httpx.Response(404)

    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: real_async_client(
            *a, **{**kw, "transport": httpx.MockTransport(valid_cdn_handler)}
        ),
    )

    provider = FASHNApiProvider(
        api_key="test-key",
        return_base64=False,
        poll_interval_sec=0.05,
    )
    out_bytes, out_mime, _ = await provider.process(
        "job-cdn", person_bytes, garment_bytes, "TOP"
    )
    assert out_bytes == cdn_image_bytes
    assert out_mime == "image/png"

    # 2. Untrusted output URL host (SSRF attempt) is blocked before any fetch
    def ssrf_handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == "https://api.fashn.ai/v1/run":
            return httpx.Response(200, json={"id": "pred-ssrf", "error": None})
        if str(request.url) == "https://api.fashn.ai/v1/status/pred-ssrf":
            return httpx.Response(
                200,
                json={
                    "id": "pred-ssrf",
                    "status": "completed",
                    "output": ["https://169.254.169.254/latest/meta-data/"],
                    "error": None,
                },
            )
        pytest.fail(f"Unexpected request to untrusted URL: {request.url}")

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: real_async_client(
            *a, **{**kw, "transport": httpx.MockTransport(ssrf_handler)}
        ),
    )

    with pytest.raises(VTONProviderError, match="Blocked untrusted output URL host"):
        await provider.process("job-ssrf", person_bytes, garment_bytes, "TOP")


@pytest.mark.asyncio
async def test_fashn_provider_error_handling_auth_quota_pose_timeout(monkeypatch):
    person_bytes = _make_test_image()
    garment_bytes = _make_test_image()
    real_async_client = httpx.AsyncClient

    # 1. HTTP 401 UnauthorizedAccess
    def auth_err_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"error": "UnauthorizedAccess", "message": "Invalid API key"}
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: real_async_client(
            *a, **{**kw, "transport": httpx.MockTransport(auth_err_handler)}
        ),
    )
    provider = FASHNApiProvider(api_key="bad-key", poll_interval_sec=0.05)
    with pytest.raises(VTONAuthError, match="authentication failed"):
        await provider.process("job-401", person_bytes, garment_bytes, "SHIRT")

    # 2. HTTP 429 OutOfCredits
    def credits_err_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429, json={"error": "OutOfCredits", "message": "Account has 0 credits remaining"}
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: real_async_client(
            *a, **{**kw, "transport": httpx.MockTransport(credits_err_handler)}
        ),
    )
    with pytest.raises(VTONQuotaError, match="insufficient credits"):
        await provider.process("job-429", person_bytes, garment_bytes, "SHIRT")

    # 3. Runtime PoseError during status polling
    def pose_err_handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).endswith("/run"):
            return httpx.Response(200, json={"id": "pred-pose-err", "error": None})
        return httpx.Response(
            200,
            json={
                "id": "pred-pose-err",
                "status": "failed",
                "output": None,
                "error": {
                    "name": "PoseError",
                    "message": "Unable to detect body pose in model image.",
                },
            },
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: real_async_client(
            *a, **{**kw, "transport": httpx.MockTransport(pose_err_handler)}
        ),
    )
    with pytest.raises(VTONValidationError, match="detect body pose"):
        await provider.process("job-pose", person_bytes, garment_bytes, "SHIRT")


@pytest.mark.asyncio
async def test_fashn_provider_tryon_max_and_poll_retry_without_duplicate_run(monkeypatch):
    person_bytes = _make_test_image()
    garment_bytes = _make_test_image()
    out_bytes = _make_test_image((90, 90, 90))
    out_uri = f"data:image/jpeg;base64,{base64.b64encode(out_bytes).decode('ascii')}"
    real_async_client = httpx.AsyncClient

    run_calls = 0
    poll_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal run_calls, poll_calls
        if str(request.url) == "https://api.fashn.ai/v1/run":
            run_calls += 1
            import json

            payload = json.loads(request.content.decode("utf-8"))
            assert payload["model_name"] == "tryon-max"
            assert "product_image" in payload["inputs"]
            assert payload["inputs"]["generation_mode"] == "fast"
            return httpx.Response(200, json={"id": "pred-max-1", "error": None})

        if str(request.url) == "https://api.fashn.ai/v1/status/pred-max-1":
            poll_calls += 1
            if poll_calls == 1:
                # Transient 502 on status poll must retry status poll, NEVER re-submit /v1/run
                return httpx.Response(502, json={"error": "BadGateway"})
            return httpx.Response(
                200,
                json={
                    "id": "pred-max-1",
                    "status": "completed",
                    "output": [out_uri],
                    "error": None,
                },
            )
        return httpx.Response(404)

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **kw: real_async_client(
            *a, **{**kw, "transport": httpx.MockTransport(handler)}
        ),
    )

    provider = FASHNApiProvider(
        api_key="valid-key",
        model_name="tryon-max",
        mode="performance",
        poll_interval_sec=0.05,
    )
    res_bytes, _, meta = await provider.process("job-max", person_bytes, garment_bytes, "TOP")
    assert res_bytes == out_bytes
    assert meta["model_name"] == "tryon-max"
    assert run_calls == 1
    assert poll_calls == 2


@pytest.mark.asyncio
async def test_huggingface_provider_success_and_quota_error(monkeypatch):
    from app.services.huggingface_provider import HuggingFaceProvider

    person_bytes = _make_test_image((200, 180, 170), fmt="JPEG")
    garment_bytes = _make_test_image((30, 80, 160), fmt="PNG")
    expected_out_bytes = _make_test_image((100, 140, 180), fmt="JPEG")

    provider = HuggingFaceProvider(
        hf_token="",
        space_id="yisol/IDM-VTON",
        timeout_seconds=30.0,
        denoise_steps=30,
    )

    # 1. Mock _run_gradio_sync to return valid image bytes
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda p_bytes, p_ext, g_bytes, g_ext, g_des: expected_out_bytes,
    )

    out_bytes, out_mime, meta = await provider.process(
        job_id="job-hf-1",
        person_image_bytes=person_bytes,
        garment_image_bytes=garment_bytes,
        category="TSHIRT",
    )
    assert out_mime == "image/jpeg"
    assert meta["is_mock"] is False
    assert meta["space_id"] == "yisol/IDM-VTON"
    assert meta["garment_description"] == "short sleeve round neck t-shirt"
    assert Image.open(io.BytesIO(out_bytes)).size == (256, 384)

    # 2. Simulate ZeroGPU quota error -> raises VTONQuotaError with HF_TOKEN hint
    def raise_quota(*_args):
        raise RuntimeError("You have exceeded your ZeroGPU quota")

    monkeypatch.setattr(provider, "_run_gradio_sync", raise_quota)
    with pytest.raises(VTONQuotaError, match="HF_TOKEN"):
        await provider.process("job-hf-quota", person_bytes, garment_bytes, "SHIRT")


