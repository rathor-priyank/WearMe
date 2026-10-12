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


def test_huggingface_region_and_height_preservation():
    import numpy as np
    from app.services.huggingface_provider import (
        prepare_person_canvas,
        restore_unmasked_regions,
    )

    # Create a non-3:4 image (e.g. 500x800) with distinct face (top), torso (middle), and bottomwear (bottom)
    orig_arr = np.zeros((800, 500, 3), dtype=np.uint8)
    orig_arr[:200, :, :] = [195, 145, 115]  # Face / skin region (top)
    orig_arr[200:550, :, :] = [230, 220, 200]  # Original sweater (middle)
    orig_arr[550:, :, :] = [160, 130, 95]  # Original khaki bottomwear (bottom)
    orig_img = Image.fromarray(orig_arr, mode="RGB")

    sent_canvas, crop_box = prepare_person_canvas(orig_img)
    assert sent_canvas.size == (768, 1024)

    # Simulate IDM-VTON mask_gray (middle torso masked to RGB(127, 127, 127))
    mg_arr = np.asarray(sent_canvas, dtype=np.uint8).copy()
    mg_arr[300:680, 150:618, :] = [127, 127, 127]
    mask_gray_canvas = Image.fromarray(mg_arr, mode="RGB")

    # Simulate IDM-VTON corrupting face and bottomwear outside the mask while generating white t-shirt inside mask
    vton_arr = np.asarray(sent_canvas, dtype=np.uint8).copy()
    vton_arr[:250, :, :] = [50, 50, 50]  # Corrupted face!
    vton_arr[700:, :, :] = [20, 20, 90]  # Corrupted bottomwear!
    vton_arr[300:680, 150:618, :] = [245, 245, 250]  # Generated white t-shirt inside mask
    vton_canvas = Image.fromarray(vton_arr, mode="RGB")

    restored = restore_unmasked_regions(
        orig_img=orig_img,
        sent_canvas=sent_canvas,
        vton_canvas=vton_canvas,
        mask_gray_canvas=mask_gray_canvas,
        crop_box=crop_box,
    )

    # 1. Exact original height and width preserved (500x800)
    assert restored.size == (500, 800)
    res_arr = np.asarray(restored, dtype=np.uint8)

    # 2. Face region (top) and bottomwear region (bottom) are 100% untouched original pixels!
    np.testing.assert_array_equal(res_arr[:150, :, :], orig_arr[:150, :, :])
    np.testing.assert_array_equal(res_arr[600:, :, :], orig_arr[600:, :, :])

    # 3. Center of upper-body torso has the new white t-shirt
    assert np.mean(res_arr[350:450, 200:300, :]) > 235


@pytest.mark.asyncio
async def test_huggingface_gradio_tryon_call_signature_and_parameter_order(monkeypatch, tmp_path):
    import gradio_client
    from app.services.huggingface_provider import HuggingFaceProvider

    person_bytes = _make_test_image((200, 180, 170), size=(300, 400), fmt="JPEG")
    garment_bytes = _make_test_image((30, 80, 160), size=(300, 400), fmt="PNG")

    # Write fake output and mask files that mocked Client.predict will return
    fake_out_path = tmp_path / "gradio_out.png"
    fake_mask_path = tmp_path / "gradio_mask.png"
    Image.new("RGB", (768, 1024), color=(240, 240, 245)).save(fake_out_path, format="PNG")
    Image.new("RGB", (768, 1024), color=(127, 127, 127)).save(fake_mask_path, format="PNG")

    init_Args: dict = {}
    predict_kwargs: dict = {}
    predict_key_order: list[str] = []

    class DummyGradioClient:
        def __init__(self, src: str, token: str | None = None, **kwargs):
            init_Args["src"] = src
            init_Args["token"] = token
            init_Args["kwargs"] = kwargs

        def predict(self, *args, **kwargs):
            assert len(args) == 0, "predict() should be called with explicit keyword arguments"
            predict_Key_list = list(kwargs.keys())
            predict_key_order.extend(predict_Key_list)
            predict_kwargs.update(kwargs)
            return (str(fake_out_path), str(fake_mask_path))

    monkeypatch.setattr(gradio_client, "Client", DummyGradioClient)
    monkeypatch.setattr(gradio_client, "handle_file", lambda p: {"path": str(p), "meta": {"_type": "gradio.FileData"}})

    provider = HuggingFaceProvider(
        hf_token="hf_mock_unit_test_token_12345",
        space_id="yisol/IDM-VTON",
        timeout_seconds=45.0,
        denoise_steps=30,
        seed=42,
    )

    out_bytes, out_mime, meta = await provider.process(
        job_id="job-hf-sig",
        person_image_bytes=person_bytes,
        garment_image_bytes=garment_bytes,
        category="JACKET",
    )

    assert init_Args["src"] == "yisol/IDM-VTON"
    assert init_Args["token"] == "hf_mock_unit_test_token_12345"
    assert init_Args["kwargs"].get("verbose") is False

    # Verify exact parameter order and values for /tryon
    assert predict_key_order == [
        "dict",
        "garm_img",
        "garment_des",
        "is_checked",
        "is_checked_crop",
        "denoise_steps",
        "seed",
        "api_name",
    ]
    assert isinstance(predict_kwargs["dict"], dict)
    assert set(predict_kwargs["dict"].keys()) == {"background", "layers", "composite"}
    assert predict_kwargs["dict"]["layers"] == []
    assert predict_kwargs["dict"]["composite"] is None
    assert predict_kwargs["garment_des"] == "upper body jacket"
    assert predict_kwargs["is_checked"] is True
    assert predict_kwargs["is_checked_crop"] is False
    assert predict_kwargs["denoise_steps"] == 30
    assert predict_kwargs["seed"] == 42
    assert predict_kwargs["api_name"] == "/tryon"

    assert out_mime == "image/jpeg"
    assert Image.open(io.BytesIO(out_bytes)).size == (300, 400)
    assert meta["authenticated_hf"] is True
    assert "hf_mock_unit_test_token_12345" not in str(meta)


@pytest.mark.asyncio
async def test_huggingface_error_classification_and_token_redaction(monkeypatch):
    import gradio_client
    from app.services.huggingface_provider import (
        HuggingFaceProvider,
        sanitize_upstream_message,
    )

    person_bytes = _make_test_image()
    garment_bytes = _make_test_image()
    secret_token = "hf_SuperSecretTokenValue987654321"

    # 1. Direct unit test of sanitize_upstream_message
    raw_err = (
        f"Failed request with token {secret_token} and "
        "Authorization: Bearer another_secret_jwt_token_xyz"
    )
    sanitized = sanitize_upstream_message(raw_err, explicit_token=secret_token)
    assert secret_token not in sanitized
    assert "another_secret_jwt_token_xyz" not in sanitized
    assert "[REDACTED_TOKEN]" in sanitized

    provider = HuggingFaceProvider(
        hf_token=secret_token,
        space_id="yisol/IDM-VTON",
        timeout_seconds=20.0,
    )

    # 2. Space sleeping / unavailable -> VTONProviderError (category='space_unavailable', retryable=True)
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda *_a: (_ for _ in ()).throw(RuntimeError("Space is sleeping or building (503)")),
    )
    with pytest.raises(VTONProviderError) as exc_space:
        await provider.process("job-sleep", person_bytes, garment_bytes, "TOP")
    assert exc_space.value.category == "space_unavailable"
    assert exc_space.value.retryable is True
    assert exc_space.value.status_code == 502

    # 3. Queue full / overloaded -> VTONQuotaError (retryable=True)
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda *_a: (_ for _ in ()).throw(RuntimeError("Queue is full! Please try again shortly.")),
    )
    with pytest.raises(VTONQuotaError) as exc_queue:
        await provider.process("job-queue", person_bytes, garment_bytes, "TOP")
    assert exc_queue.value.retryable is True
    assert exc_queue.value.status_code == 429

    # 4. GPU quota exhausted -> VTONQuotaError (retryable=False)
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda *_a: (_ for _ in ()).throw(
            RuntimeError(f"You have exceeded your ZeroGPU quota for {secret_token}")
        ),
    )
    with pytest.raises(VTONQuotaError) as exc_quota:
        await provider.process("job-quota", person_bytes, garment_bytes, "TOP")
    assert exc_quota.value.retryable is False
    assert exc_quota.value.status_code == 429
    assert secret_token not in exc_quota.value.message

    # 5. Invalid or expired token -> VTONAuthError (retryable=False)
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda *_a: (_ for _ in ()).throw(
            RuntimeError(f"401 Unauthorized: Invalid token {secret_token}")
        ),
    )
    with pytest.raises(VTONAuthError) as exc_auth:
        await provider.process("job-auth", person_bytes, garment_bytes, "TOP")
    assert exc_auth.value.retryable is False
    assert exc_auth.value.status_code == 502
    assert secret_token not in exc_auth.value.message

    # 6. Timeout -> VTONTimeoutError (retryable=True, status_code=504)
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda *_a: (_ for _ in ()).throw(TimeoutError("Gradio prediction timed out")),
    )
    with pytest.raises(VTONTimeoutError) as exc_timeout:
        await provider.process("job-timeout", person_bytes, garment_bytes, "TOP")
    assert exc_timeout.value.retryable is True
    assert exc_timeout.value.status_code == 504

    # 7. API schema change (TypeError on parameters) -> VTONProviderError (category='schema_mismatch', retryable=False)
    monkeypatch.setattr(
        provider,
        "_run_gradio_sync",
        lambda *_a: (_ for _ in ()).throw(
            TypeError("predict() got an unexpected keyword argument 'garment_des'")
        ),
    )
    with pytest.raises(VTONProviderError) as exc_schema:
        await provider.process("job-schema-err", person_bytes, garment_bytes, "TOP")
    assert exc_schema.value.category == "schema_mismatch"
    assert exc_schema.value.retryable is False

    # 8. Malformed result from Gradio Client.predict (returns empty tuple) -> schema_mismatch
    provider_malformed = HuggingFaceProvider(hf_token=secret_token, space_id="yisol/IDM-VTON")

    class MalformedGradioClient:
        def __init__(self, *args, **kwargs):
            pass

        def predict(self, *args, **kwargs):
            return ()

    monkeypatch.setattr(gradio_client, "Client", MalformedGradioClient)
    monkeypatch.setattr(gradio_client, "handle_file", lambda p: str(p))
    with pytest.raises(VTONProviderError) as exc_malformed:
        await provider_malformed.process("job-malformed", person_bytes, garment_bytes, "TOP")
    assert exc_malformed.value.category == "schema_mismatch"
    assert exc_malformed.value.retryable is False


@pytest.mark.asyncio
async def test_huggingface_preserves_raw_and_composited_debug_artifacts(monkeypatch, tmp_path) -> None:
    """
    Verify Requirement 6:
    Original inputs, preprocessed canvas, raw uncomposited provider output, and raw mask
    are preserved alongside the final composited output when `debug_artifact_dir` is set,
    ensuring upper-body compositing never silently hides raw model defects during evaluation.
    """
    import gradio_client
    import numpy as np
    from pathlib import Path
    from app.services.huggingface_provider import HuggingFaceProvider

    # Person image with distinct green trousers in lower half (0..180, 0..320)
    person_img = Image.new("RGB", (240, 320), color=(210, 210, 210))
    for y in range(200, 320):
        for x in range(240):
            person_img.putpixel((x, y), (20, 160, 40))
    p_buf = io.BytesIO()
    person_img.save(p_buf, format="JPEG", quality=95)
    person_bytes = p_buf.getvalue()
    garment_bytes = _make_test_image(color=(180, 30, 30), size=(240, 320), fmt="JPEG")

    # Fake Gradio output where the raw model introduces a bright magenta defect
    # in the lower trousers area (outside the upper-body mask)
    raw_vton = Image.new("RGB", (768, 1024), color=(180, 30, 30))
    for y in range(700, 1024):
        for x in range(768):
            raw_vton.putpixel((x, y), (250, 0, 250))  # Raw model defect outside mask
    raw_path = tmp_path / "gradio_raw.png"
    raw_vton.save(raw_path, format="PNG")

    # Mask gray: only upper torso (y=220..560, x=180..580) is neutral gray RGB(128,128,128)
    mask_gray = Image.new("RGB", (768, 1024), color=(10, 10, 10))
    for y in range(220, 560):
        for x in range(180, 580):
            mask_gray.putpixel((x, y), (128, 128, 128))
    mask_path = tmp_path / "gradio_mask.png"
    mask_gray.save(mask_path, format="PNG")

    class ArtifactMockGradioClient:
        def __init__(self, *args, **kwargs):
            pass

        def predict(self, *args, **kwargs):
            return (str(raw_path), str(mask_path))

    monkeypatch.setattr(gradio_client, "Client", ArtifactMockGradioClient)
    monkeypatch.setattr(gradio_client, "handle_file", lambda p: str(p))

    artifact_dir = tmp_path / "eval_artifacts"
    provider = HuggingFaceProvider(hf_token="hf_test_token_123456", space_id="yisol/IDM-VTON")
    out_bytes, out_mime, meta = await provider.process(
        job_id="job-eval-artifacts",
        person_image_bytes=person_bytes,
        garment_image_bytes=garment_bytes,
        category="TSHIRT",
        debug_artifact_dir=artifact_dir,
    )

    assert out_mime == "image/jpeg"
    assert "debug_artifacts" in meta
    dbg = meta["debug_artifacts"]

    for required_key in (
        "person_orig",
        "garment_orig",
        "person_preprocessed",
        "provider_raw_output",
        "provider_raw_unpadded",
        "provider_mask",
        "final_composited",
    ):
        assert required_key in dbg
        assert Path(dbg[required_key]).is_file()

    # Verify the raw unpadded output preserves the raw magenta defect in the lower trousers
    # while the final composited output restores the original green trousers
    with Image.open(dbg["provider_raw_unpadded"]) as raw_unpadded_im:
        raw_arr = np.asarray(raw_unpadded_im.convert("RGB"))
    with Image.open(dbg["final_composited"]) as final_comp_im:
        comp_arr = np.asarray(final_comp_im.convert("RGB"))

    # Sample lower trousers pixel at (120, 280)
    raw_pixel = raw_arr[280, 120]
    comp_pixel = comp_arr[280, 120]

    # Raw output has magenta defect (high R & B, low G) visible for evaluators
    assert int(raw_pixel[0]) > 200 and int(raw_pixel[2]) > 200 and int(raw_pixel[1]) < 50
    # Composited output has original green trousers (high G, low R & B)
    assert int(comp_pixel[1]) > 130 and int(comp_pixel[0]) < 60


@pytest.mark.asyncio
async def test_evaluation_harness_mock_and_permission_enforcement(tmp_path) -> None:
    """
    Verify Requirements 2, 3, 4, 6, 7:
    - 24-case default manifest (within 20-30 pairs requirement) with explicit permission fields.
    - PermissionError raised if consent_verified is False.
    - Adapter benchmark records inputs, model version, settings, latency, cost, raw/final paths,
      comparison strip, and unpopulated 1-5 human rubric score placeholders.
    """
    import sys
    from pathlib import Path

    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    from scripts.evaluate_vton import (
        DEFAULT_24_CASES,
        EvalCase,
        build_adapter_for_provider,
        generate_markdown_report,
        run_evaluation,
        verify_case_permission,
    )

    assert 20 <= len(DEFAULT_24_CASES) <= 30
    assert len(DEFAULT_24_CASES) == 24
    for c in DEFAULT_24_CASES:
        verify_case_permission(c)

    # Unconsented image pair must be rejected before running
    unconsented_case = EvalCase(
        case_id="TC-99",
        title="Unconsented test",
        category="TSHIRT",
        person_condition="Test",
        garment_condition="Test",
        consent_verified=False,
    )
    with pytest.raises(PermissionError, match="consent_verified"):
        verify_case_permission(unconsented_case)

    mock_adapter = build_adapter_for_provider("mock")
    subset = DEFAULT_24_CASES[:2]
    out_dir = tmp_path / "eval_out"
    results = await run_evaluation(mock_adapter, subset, out_dir, run_id="test_run_01")

    assert len(results) == 2
    for res in results:
        assert res.status == "COMPLETED"
        assert res.adapter_name == "mock"
        assert res.model_version == "pillow-mock-v1"
        assert res.person_sha256 is not None
        assert res.garment_sha256 is not None
        assert res.raw_output_path and Path(res.raw_output_path).is_file()
        assert res.output_path and Path(res.output_path).is_file()
        assert res.comparison_strip_path and Path(res.comparison_strip_path).is_file()
        # Verify human rubric scores are None placeholders (never fabricated automatically)
        assert res.human_rubric_scores["garment_fidelity_1_to_5"] is None
        assert res.human_rubric_scores["identity_preservation_1_to_5"] is None
        assert res.human_rubric_scores["fit_fabric_realism_1_to_5"] is None
        assert res.human_rubric_scores["visual_artifacts_1_to_5"] is None

    report_md = out_dir / "report.md"
    generate_markdown_report("test_run_01", results, report_md)
    assert report_md.is_file()
    md_text = report_md.read_text(encoding="utf-8")
    assert "Human Quality Scoring Rubric (1–5 Scale)" in md_text
    assert "cannot be" in md_text and "fully automated" in md_text


@pytest.mark.asyncio
async def test_120_case_v2_manifest_and_incomplete_dataset_safeguards(tmp_path) -> None:
    """
    Verify Phase 2 & Phase 4 requirements:
    - 120-case v2.0 manifest retains 24 clothing cases and allocates 96 cases across
      jewellery (20), eyewear (14), wristwear (12), bags (12), footwear (16),
      headwear (12), and accessories (10).
    - Explicitly marked `dataset_status="template_incomplete_images"` and `ready_case_count=0`
      when image paths are unpopulated.
    - No invented image paths, permissions, results, or human scores.
    - Non-mock execution refuses to run unpopulated/unconsented template cases.
    """
    import json
    from pathlib import Path
    from scripts.evaluate_vton import load_manifest_cases, run_evaluation
    from app.services.huggingface_provider import HuggingFaceProvider

    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    v2_path = repo_root / "scripts" / "eval_manifest.v2.example.json"
    assert v2_path.is_file()

    raw_v2 = json.loads(v2_path.read_text(encoding="utf-8"))
    assert raw_v2["schema_version"] == "2.0"
    assert raw_v2["dataset_status"] == "template_incomplete_images"
    assert raw_v2["total_cases"] == 120
    assert raw_v2["ready_case_count"] == 0
    assert raw_v2["domain_allocations"] == {
        "clothing": 24,
        "jewellery": 20,
        "eyewear": 14,
        "wristwear": 12,
        "bags": 12,
        "footwear": 16,
        "headwear": 12,
        "accessories": 10,
    }

    cases, meta = load_manifest_cases(v2_path)
    assert len(cases) == 120
    assert meta["dataset_status"] == "template_incomplete_images"
    assert meta["ready_case_count"] == 0

    for item in raw_v2["cases"]:
        assert item["person_image_path"] is None
        assert item["product_image_path"] is None
        assert item["image_readiness"] == "missing_images"
        assert item["consent_verified"] is False
        assert item["evaluation_record"]["status"] == "NOT_RUN"
        scores = item["evaluation_record"]["human_scores"]
        assert scores["product_fidelity_1_to_5"] is None
        assert scores["placement_and_fit_1_to_5"] is None
        assert scores["identity_and_anatomy_preservation_1_to_5"] is None
        assert scores["occlusion_and_realism_1_to_5"] is None
        assert scores["lighting_pose_and_quality_robustness_1_to_5"] is None

    # Running a real provider against an unconsented/missing-image v2 template case
    # must fail before any network/GPU call is attempted
    hf_prov = HuggingFaceProvider(hf_token="hf_dummy", space_id="yisol/IDM-VTON")
    res_list = await run_evaluation(hf_prov, cases[:2], tmp_path / "blocked_run")
    assert all(r.status == "SKIPPED_OR_ERROR" for r in res_list)
    assert all(r.error_category == "PermissionError" for r in res_list)


@pytest.mark.asyncio
async def test_category_router_prevents_idm_vton_misuse_and_routes_categories() -> None:
    """
    Verify Phase 3 & Phase 5 requirements:
    - CategoryRouterProvider routes upper-body subcategories (`TSHIRT`, `SWEATER`, `HOODIE`)
      to HuggingFaceProvider (`yisol/IDM-VTON`).
    - Non-upper-body clothing (`DRESS`, `TROUSERS`, `SAREE`) and non-clothing wearables
      (`NECKLACE`, `SUNGLASSES`, `WATCH`, `HANDBAG`, `SNEAKERS`, `HAT`, `BELT`) are
      NEVER forced through the IDM-VTON `/tryon` endpoint and NEVER silently fall back to mock.
    - FASHNApiProvider with `allow_extended_clothing=True` maps `TROUSERS`/`SKIRT` to `bottoms`
      and `DRESS`/`ETHNIC_WEAR` to `one-pieces`, while rejecting non-clothing accessories on v1.6.
    - GET `/try-on/categories` returns all 35 subcategories with honest `live_validation_status`.
    """
    from app.services.category_router import CategoryRouterProvider
    from app.services.huggingface_provider import HuggingFaceProvider
    from app.services.mock_provider import MockProvider

    hf_router = CategoryRouterProvider(
        HuggingFaceProvider(hf_token="hf_test_123456", space_id="yisol/IDM-VTON")
    )

    # 1. Upper-body clothing routes to IDM-VTON
    for upper_subcat in ("TSHIRT", "SHIRT", "SWEATER", "HOODIE", "JACKET", "TOP"):
        spec, route = hf_router.resolve_route("CLOTHING", upper_subcat)
        assert route == "idm_vton_upper_body"
        assert spec.live_validation_status == "verified_live_idm_vton"

    # 2. Lower-body, dresses, sarees, and all non-clothing wearables are blocked on IDM-VTON
    for non_upper in (
        "DRESS",
        "TROUSERS",
        "SKIRT",
        "SAREE",
        "NECKLACE",
        "EARRINGS",
        "RING",
        "SUNGLASSES",
        "WATCH",
        "HANDBAG",
        "SNEAKERS",
        "HAT",
        "BELT",
        "SCARF",
    ):
        with pytest.raises(VTONValidationError) as exc_info:
            hf_router.resolve_route(non_upper, non_upper)
        assert exc_info.value.category == "unsupported_category_for_provider"
        assert "IDM-VTON" in exc_info.value.message

    # 3. FASHN v1.6 extended clothing router maps tops, bottoms, and one-pieces
    fashn_router = CategoryRouterProvider(
        FASHNApiProvider(
            api_key="fa-test-key",
            model_name="tryon-v1.6",
            allow_extended_clothing=True,
        )
    )
    _, route_top = fashn_router.resolve_route("CLOTHING", "SWEATER")
    assert route_top == "fashn_tryon-v1.6_tops"
    _, route_bottom = fashn_router.resolve_route("CLOTHING", "TROUSERS")
    assert route_bottom == "fashn_tryon-v1.6_bottoms"
    _, route_dress = fashn_router.resolve_route("CLOTHING", "DRESS")
    assert route_dress == "fashn_tryon-v1.6_one-pieces"

    with pytest.raises(VTONValidationError) as exc_fashn:
        fashn_router.resolve_route("EYEWEAR", "SUNGLASSES")
    assert exc_fashn.value.category == "unsupported_category_for_provider"

    # 4. Extended MockProvider places overlay in category-specific target body region
    ext_mock_router = CategoryRouterProvider(
        MockProvider(allow_extended_categories=True),
        allow_extended_mock=True,
    )
    person_bytes = _make_test_image(color=(200, 190, 180), size=(300, 400), fmt="JPEG")
    product_bytes = _make_test_image(color=(40, 80, 160), size=(120, 80), fmt="JPEG")

    _, _, eyewear_meta = await ext_mock_router.process(
        job_id="job-eyewear-mock",
        person_image_bytes=person_bytes,
        garment_image_bytes=product_bytes,
        category="EYEWEAR",
        subcategory="SUNGLASSES",
    )
    _, _, footwear_meta = await ext_mock_router.process(
        job_id="job-footwear-mock",
        person_image_bytes=person_bytes,
        garment_image_bytes=product_bytes,
        category="FOOTWEAR",
        subcategory="SNEAKERS",
    )
    assert eyewear_meta["target_body_region"] == "face_eyes_bridge"
    assert footwear_meta["target_body_region"] == "feet_ankles"
    # Eyewear top coordinate is near the face (top of image), footwear is near the bottom (feet)
    assert eyewear_meta["composite_top"] < footwear_meta["composite_top"]
    assert eyewear_meta["live_validation_status"] == "requires_specialized_model_unverified_live"

    # 5. Verify GET /try-on/categories endpoint
    mock_app = create_app(cfg=Settings(ai_provider="mock"))
    transport = ASGITransport(app=mock_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cat_res = await client.get("/try-on/categories")
        assert cat_res.status_code == 200
        payload = cat_res.json()
        assert len(payload["categories"]) == 38


def test_pilot_20_manifest_validation_and_missing_inputs() -> None:
    """
    Verify Requirements 2, 3, 7, 8:
    - Pilot manifest has 20 cases: 5 clothing, 5 necklaces/pendants, 5 earrings, 5 eyewear.
    - No fabricated image paths, permissions, consent, scores, or results.
    - Missing inputs are explicitly identified on every unpopulated case.
    - Validator rejects manifests that falsely claim dataset_status='ready', have wrong
      category counts, or fabricate human scores on NOT_RUN cases.
    """
    import copy
    import json
    from pathlib import Path
    from scripts.evaluate_vton import (
        load_manifest_cases,
        validate_pilot_manifest,
    )

    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    pilot_path = repo_root / "scripts" / "eval_manifest.pilot20.example.json"
    assert pilot_path.is_file()

    raw_pilot = json.loads(pilot_path.read_text(encoding="utf-8"))
    summary = validate_pilot_manifest(raw_pilot)
    assert summary["valid"] is True
    assert summary["total_cases"] == 20
    assert summary["ready_case_count"] == 0
    assert summary["missing_input_case_count"] == 20
    assert summary["group_counts"] == {
        "clothing": 5,
        "necklaces_pendants": 5,
        "earrings": 5,
        "eyewear": 5,
    }

    cases, meta = load_manifest_cases(pilot_path)
    assert len(cases) == 20
    assert meta["dataset_status"] == "template_incomplete_images"
    assert meta["ready_case_count"] == 0

    for item, eval_case in zip(raw_pilot["cases"], cases):
        assert item["person_image_path"] is None
        assert item["product_image_path"] is None
        assert item["consent_verified"] is False
        assert item["image_readiness"] == "missing_images"
        assert set(item["missing_inputs"]) == {
            "person_image_path",
            "product_image_path",
            "permission_source",
            "license_url",
            "attribution",
            "consent_verified",
        }
        assert set(eval_case.compute_missing_inputs()) == {
            "person_image_path",
            "product_image_path",
            "permission_source",
            "license_url",
            "attribution",
            "consent_verified",
        }
        scores = item["evaluation_record"]["human_scores"]
        for k in (
            "product_fidelity_1_to_5",
            "placement_and_fit_1_to_5",
            "identity_and_anatomy_preservation_1_to_5",
            "occlusion_and_realism_1_to_5",
            "lighting_pose_and_quality_robustness_1_to_5",
        ):
            assert scores[k] is None

    # Falsely claiming dataset_status='ready' when images are missing must fail validation
    tampered_ready = copy.deepcopy(raw_pilot)
    tampered_ready["dataset_status"] = "ready"
    with pytest.raises(ValueError, match="dataset_status='ready'"):
        validate_pilot_manifest(tampered_ready)

    # Fabricating a human score when status=='NOT_RUN' must fail validation
    tampered_score = copy.deepcopy(raw_pilot)
    tampered_score["cases"][0]["evaluation_record"]["human_scores"]["product_fidelity_1_to_5"] = 5
    with pytest.raises(ValueError, match="non-blank human score"):
        validate_pilot_manifest(tampered_score)


@pytest.mark.asyncio
async def test_pilot_20_unsupported_and_specialized_category_handling(tmp_path) -> None:
    """
    Verify Requirements 4, 5, 8:
    - Permission validation remains mandatory before loading images.
    - Categories without a validated live provider (necklaces/pendants, earrings, eyewear)
      report `requires_specialized_model` and are NEVER routed to IDM-VTON, FASHN clothing
      inference, or MockProvider as though they were real.
    - Unknown categories or incompatible provider-category combinations report `unsupported`.
    """
    from pathlib import Path
    from scripts.evaluate_vton import (
        EvalCase,
        build_adapter_for_provider,
        run_evaluation,
    )
    from app.services.huggingface_provider import HuggingFaceProvider

    p_file = tmp_path / "person.jpg"
    g_file = tmp_path / "product.jpg"
    p_file.write_bytes(_make_test_image(color=(210, 190, 180), size=(256, 384), fmt="JPEG"))
    g_file.write_bytes(_make_test_image(color=(200, 170, 60), size=(256, 384), fmt="JPEG"))

    def make_consented_case(cid: str, cat: str, subcat: str) -> EvalCase:
        return EvalCase(
            case_id=cid,
            title=f"Test {subcat}",
            category=cat,
            subcategory=subcat,
            person_condition="Frontal portrait",
            garment_condition="Isolated product",
            person_image_path=str(p_file),
            product_image_path=str(g_file),
            image_readiness="ready",
            permission_source="user_consented_own_photo",
            license_url="https://creativecommons.org/publicdomain/zero/1.0/",
            attribution="Unit test synthetic asset",
            consent_verified=True,
        )

    non_validated_cases = [
        make_consented_case("PILOT-006", "JEWELLERY", "NECKLACE"),
        make_consented_case("PILOT-007", "JEWELLERY", "PENDANT"),
        make_consented_case("PILOT-011", "JEWELLERY", "EARRINGS"),
        make_consented_case("PILOT-016", "EYEWEAR", "PRESCRIPTION_GLASSES"),
        make_consented_case("PILOT-018", "EYEWEAR", "SUNGLASSES"),
    ]

    # 1. Default mock adapter must NOT synthesize fake output for non-validated categories
    mock_adapter = build_adapter_for_provider("mock")
    mock_results = await run_evaluation(mock_adapter, non_validated_cases, tmp_path / "mock_out")
    for res in mock_results:
        assert res.status == "requires_specialized_model"
        assert res.provider_support_status == "requires_specialized_model"
        assert res.output_path is None
        assert res.raw_output_path is None
        assert res.credits_used == "0"
        assert res.estimated_cost_usd == 0.0

    # 2. HuggingFaceProvider (IDM-VTON) must NOT be called for non-validated or lower-body categories
    hf_called = False

    def forbidden_gradio(*_args, **_kwargs):
        nonlocal hf_called
        hf_called = True
        raise AssertionError("IDM-VTON should never be called for non-upper-body categories")

    hf_prov = HuggingFaceProvider(hf_token="hf_test_token", space_id="yisol/IDM-VTON")
    hf_prov._run_gradio_sync = forbidden_gradio  # type: ignore[method-assign]

    unknown_and_lower_cases = [
        make_consented_case("UNSUP-01", "CLOTHING", "TROUSERS"),
        make_consented_case("UNSUP-02", "UNKNOWN_DOMAIN", "JETPACK"),
    ]
    hf_results = await run_evaluation(
        hf_prov,
        non_validated_cases + unknown_and_lower_cases,
        tmp_path / "hf_out",
    )
    assert hf_called is False
    for res in hf_results[:5]:
        assert res.status == "requires_specialized_model"
        assert res.provider_support_status == "requires_specialized_model"
        assert res.output_path is None
    for res in hf_results[5:]:
        assert res.status == "unsupported"
        assert res.provider_support_status == "unsupported"
        assert res.output_path is None


@pytest.mark.asyncio
async def test_pilot_20_output_provenance_and_blank_human_scores(monkeypatch, tmp_path) -> None:
    """
    Verify Requirements 6, 7, 8:
    - Preserves raw provider output, provider mask, final output, comparison strip,
      input/output SHA-256 hashes, model/version metadata, latency, and estimated cost.
    - Keeps all human evaluation scores blank (`None`) until an evaluator fills them in.
    """
    import gradio_client
    from pathlib import Path
    from scripts.evaluate_vton import EvalCase, BenchmarkAdapter, run_evaluation
    from app.services.huggingface_provider import HuggingFaceProvider

    p_file = tmp_path / "person_clothing.jpg"
    g_file = tmp_path / "garment_tshirt.jpg"
    p_file.write_bytes(_make_test_image(color=(205, 185, 170), size=(240, 320), fmt="JPEG"))
    g_file.write_bytes(_make_test_image(color=(40, 90, 175), size=(240, 320), fmt="JPEG"))

    raw_path = tmp_path / "hf_raw.png"
    mask_path = tmp_path / "hf_mask.png"
    Image.new("RGB", (768, 1024), color=(45, 95, 180)).save(raw_path, format="PNG")
    Image.new("RGB", (768, 1024), color=(128, 128, 128)).save(mask_path, format="PNG")

    class ProvenanceGradioClient:
        def __init__(self, *args, **kwargs):
            pass

        def predict(self, *args, **kwargs):
            return (str(raw_path), str(mask_path))

    monkeypatch.setattr(gradio_client, "Client", ProvenanceGradioClient)
    monkeypatch.setattr(gradio_client, "handle_file", lambda p: str(p))

    hf_prov = HuggingFaceProvider(hf_token="hf_prov_test", space_id="yisol/IDM-VTON")
    adapter = BenchmarkAdapter(
        adapter_name="idm-vton",
        provider=hf_prov,
        model_version="yisol/IDM-VTON",
        settings={"denoise_steps": 30, "seed": 42},
        cost_per_credit_usd=0.0,
    )

    clothing_case = EvalCase(
        case_id="PILOT-001",
        title="Clothing Pilot #1 — T-Shirt",
        category="CLOTHING",
        subcategory="TSHIRT",
        person_condition="Frontal portrait",
        garment_condition="Flat-lay t-shirt",
        person_image_path=str(p_file),
        product_image_path=str(g_file),
        image_readiness="ready",
        permission_source="user_consented_own_photo",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Unit test asset",
        consent_verified=True,
    )

    results = await run_evaluation(adapter, [clothing_case], tmp_path / "prov_out")
    assert len(results) == 1
    res = results[0]
    assert res.status == "COMPLETED"
    assert res.provider_support_status == "supported"
    assert res.model_version == "yisol/IDM-VTON"
    assert res.duration_ms >= 0
    assert res.estimated_cost_usd == 0.0
    assert res.person_sha256 is not None and len(res.person_sha256) == 16
    assert res.garment_sha256 is not None and len(res.garment_sha256) == 16
    assert res.raw_output_sha256 is not None and len(res.raw_output_sha256) == 16
    assert res.output_sha256 is not None and len(res.output_sha256) == 16
    assert res.raw_output_path and Path(res.raw_output_path).is_file()
    assert res.mask_output_path and Path(res.mask_output_path).is_file()
    assert res.final_output_path and Path(res.final_output_path).is_file()
    assert res.output_path and Path(res.output_path).is_file()
    assert res.comparison_strip_path and Path(res.comparison_strip_path).is_file()

    for score_key in (
        "product_fidelity_1_to_5",
        "placement_and_fit_1_to_5",
        "identity_and_anatomy_preservation_1_to_5",
        "occlusion_and_realism_1_to_5",
        "lighting_pose_and_quality_robustness_1_to_5",
    ):
        assert res.human_rubric_scores[score_key] is None


@pytest.mark.asyncio
async def test_pilot_20_zero_cost_dry_run_behavior(tmp_path) -> None:
    """
    Verify Requirement 8 & 10:
    - Zero-cost dry-run behavior across all 20 pilot cases consumes 0 GPU quota and $0 cost.
    - Reports `DRY_RUN_MISSING_INPUTS` on the 5 unpopulated clothing template cases and
      `requires_specialized_model` on the 15 non-clothing cases (5 necklaces/pendants,
      5 earrings, 5 eyewear).
    """
    from pathlib import Path
    from scripts.evaluate_vton import (
        build_adapter_for_provider,
        load_manifest_cases,
        run_evaluation,
    )

    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    pilot_path = repo_root / "scripts" / "eval_manifest.pilot20.example.json"
    cases, _ = load_manifest_cases(pilot_path)
    assert len(cases) == 20

    idm_adapter = build_adapter_for_provider("idm-vton")
    dry_results = await run_evaluation(
        idm_adapter,
        cases,
        tmp_path / "dry_run_out",
        dry_run=True,
    )
    assert len(dry_results) == 20
    assert sum(r.estimated_cost_usd for r in dry_results) == 0.0
    assert all(r.credits_used == "0" for r in dry_results)
    assert all(r.output_path is None for r in dry_results)

    clothing_results = [r for r in dry_results if r.domain == "clothing"]
    non_clothing_results = [r for r in dry_results if r.domain != "clothing"]
    assert len(clothing_results) == 5
    assert len(non_clothing_results) == 15
    assert all(r.provider_support_status == "supported" for r in clothing_results)
    assert all(r.status == "DRY_RUN_MISSING_INPUTS" for r in clothing_results)
    assert all("person_image_path" in r.missing_inputs for r in clothing_results)
    assert all(r.status == "requires_specialized_model" for r in non_clothing_results)
    assert all(r.provider_support_status == "requires_specialized_model" for r in non_clothing_results)


def _make_portrait_person_image(
    size: tuple[int, int] = (320, 420),
    skin_rgb: tuple[int, int, int] = (215, 165, 135),
    torso_rgb: tuple[int, int, int] = (35, 55, 95),
    bg_rgb: tuple[int, int, int] = (242, 242, 245),
    head_shift_x: int = 0,
) -> bytes:
    """
    Create a deterministic synthetic upper-body portrait image with a head/neck
    skin silhouette and shoulder/torso silhouette for testing NecklacePocProvider.
    """
    from PIL import ImageDraw

    w, h = size
    img = Image.new("RGB", size, color=bg_rgb)
    draw = ImageDraw.Draw(img)

    # Shoulders and upper torso silhouette
    sh_left = int(w * 0.16)
    sh_right = int(w * 0.84)
    sh_top = int(h * 0.36)
    draw.rectangle([sh_left, sh_top, sh_right, h - 1], fill=torso_rgb)

    # Exposed V-neck / clavicle skin region
    cx = w // 2 + head_shift_x
    draw.polygon(
        [
            (cx - int(w * 0.16), sh_top),
            (cx + int(w * 0.16), sh_top),
            (cx, int(h * 0.50)),
        ],
        fill=skin_rgb,
    )

    # Neck column
    neck_half = int(w * 0.08)
    draw.rectangle(
        [cx - neck_half, int(h * 0.24), cx + neck_half, sh_top + 6],
        fill=skin_rgb,
    )

    # Head oval
    head_rx = int(w * 0.14)
    head_ry = int(h * 0.11)
    head_cy = int(h * 0.17)
    draw.ellipse(
        [cx - head_rx, head_cy - head_ry, cx + head_rx, head_cy + head_ry],
        fill=skin_rgb,
    )

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _make_necklace_product_image(
    size: tuple[int, int] = (260, 220),
    rgba_transparent: bool = True,
) -> bytes:
    """
    Create a deterministic isolated necklace/pendant product image on a transparent
    or studio-white background.
    """
    from PIL import ImageDraw

    w, h = size
    if rgba_transparent:
        img = Image.new("RGBA", size, color=(0, 0, 0, 0))
    else:
        img = Image.new("RGBA", size, color=(252, 252, 252, 255))
    draw = ImageDraw.Draw(img)

    # Gold U-shaped chain arc + central pendant drop
    gold = (212, 175, 55, 255)
    gem = (180, 30, 60, 255)
    left_x, right_x = int(w * 0.18), int(w * 0.82)
    top_y, bottom_y = int(h * 0.16), int(h * 0.72)

    draw.arc([left_x, top_y, right_x, bottom_y], start=0, end=180, fill=gold, width=7)
    cx = w // 2
    pendant_top = bottom_y - 4
    draw.ellipse([cx - 14, pendant_top, cx + 14, pendant_top + 28], fill=gem, outline=gold, width=3)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_necklace_poc_feature_flag_and_category_routing() -> None:
    """
    Verify Necklace/Pendant PoC routing & feature flag behavior:
    1. When `enable_necklace_poc=False` (default), `NECKLACE` and `PENDANT` report
       `requires_specialized_model` and raise `VTONConfigError` / `VTONValidationError`.
    2. When `enable_necklace_poc=True`, `NECKLACE` and `PENDANT` route to
       `NecklacePocProvider` (`landmark_jewellery_neck`) with `support_status='experimental_poc'`.
    3. `EARRINGS`, `EYEWEAR`, `RING`, `WATCH`, etc. remain `requires_specialized_model`
       even when `enable_necklace_poc=True` and are never routed to IDM-VTON, FASHN, or Mock.
    4. Missing optional MediaPipe dependency (`require_mediapipe=True`) raises `VTONConfigError`.
    """
    from app.services.category_router import CategoryRouterProvider
    from app.services.mock_provider import MockProvider
    from app.services.necklace_poc_provider import NecklacePocProvider

    person_bytes = _make_portrait_person_image()
    product_bytes = _make_necklace_product_image()

    # 1. Direct provider with enabled=False raises VTONConfigError
    disabled_poc = NecklacePocProvider(enabled=False)
    assert await disabled_poc.health_check() is False
    with pytest.raises(VTONConfigError, match="ENABLE_NECKLACE_POC=true"):
        await disabled_poc.process("job-disabled", person_bytes, product_bytes, "NECKLACE")

    # 2. Missing MediaPipe dependency check raises VTONConfigError when explicitly required
    mediapipe_required_poc = NecklacePocProvider(enabled=True, require_mediapipe=True)
    with pytest.raises(VTONConfigError, match="mediapipe"):
        await mediapipe_required_poc.process("job-mp", person_bytes, product_bytes, "NECKLACE")

    # 3. Router with enable_necklace_poc=False (default) keeps NECKLACE/PENDANT as requires_specialized_model
    default_router = CategoryRouterProvider(MockProvider(), enable_necklace_poc=False)
    for subcat in ("NECKLACE", "PENDANT", "EARRINGS", "SUNGLASSES"):
        _, status, route = default_router.classify_support("JEWELLERY", subcat)
        assert status == "requires_specialized_model"
        assert route is None

    # 4. Router with enable_necklace_poc=True enables ONLY NECKLACE and PENDANT
    enabled_router = CategoryRouterProvider(MockProvider(), enable_necklace_poc=True)
    for subcat in ("NECKLACE", "PENDANT"):
        spec, status, route = enabled_router.classify_support("JEWELLERY", subcat)
        assert spec is not None
        assert status == "experimental_poc"
        assert route == "landmark_jewellery_neck"
        _, resolved = enabled_router.resolve_route("JEWELLERY", subcat)
        assert resolved == "landmark_jewellery_neck"

    # EARRINGS, CHAIN, EYEWEAR, WATCH still require specialized models
    for other_subcat in ("CHAIN", "EARRINGS", "RING", "PRESCRIPTION_GLASSES", "SUNGLASSES", "WATCH"):
        _, status, route = enabled_router.classify_support(other_subcat, other_subcat)
        assert status == "requires_specialized_model"
        assert route is None
        with pytest.raises(VTONValidationError) as exc_info:
            enabled_router.resolve_route(other_subcat, other_subcat)
        assert exc_info.value.category == "requires_specialized_model"

    # 5. FastAPI /try-on/categories and /try-on with enable_necklace_poc=True
    poc_app = create_app(cfg=Settings(ai_provider="mock", enable_necklace_poc=True))
    transport = ASGITransport(app=poc_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cat_res = await client.get("/try-on/categories")
        assert cat_res.status_code == 200
        cat_body = cat_res.json()
        assert cat_body["necklace_poc_enabled"] is True
        by_sub = {c["subcategory"]: c for c in cat_body["categories"]}
        assert by_sub["NECKLACE"]["provider_support_status"] == "experimental_poc"
        assert by_sub["PENDANT"]["provider_support_status"] == "experimental_poc"
        assert by_sub["EARRINGS"]["provider_support_status"] == "requires_specialized_model"
        assert by_sub["TSHIRT"]["provider_support_status"] == "supported"

        try_res = await client.post(
            "/try-on",
            data={"job_id": "job-neck-api", "category": "ACCESSORY", "subcategory": "NECKLACE"},
            files={
                "person_image": ("person.jpg", person_bytes, "image/jpeg"),
                "garment_image": ("necklace.png", product_bytes, "image/png"),
            },
        )
        assert try_res.status_code == 200
        try_body = try_res.json()
        assert try_body["provider"] == "necklace-poc"
        assert try_body["metadata"]["is_experimental_poc"] is True
        assert try_body["metadata"]["subcategory"] == "NECKLACE"
        assert try_body["metadata"]["selected_route"] == "landmark_jewellery_neck"


@pytest.mark.asyncio
async def test_necklace_poc_failures_never_return_false_success() -> None:
    """
    Verify all Necklace/Pendant PoC failure cases fail explicitly with structured
    error categories and NEVER return an unmodified person image or mock image as success:
    - Unsupported category (`EARRINGS`, `TSHIRT`) -> `unsupported_category_for_provider`
    - Low resolution person image -> `unreliable_landmarks`
    - Blank/uniform person image (no face/neck) -> `no_detectable_face_or_neck`
    - Extreme head yaw (> 25 deg) -> `unsuitable_pose`
    - Blank or full-bleed cluttered product image -> `segmentation_failure`
    - Extreme aspect ratio product -> `unsupported_necklace_type`
    - Timeout exceeded -> `VTONTimeoutError`
    """
    from app.services.necklace_poc_provider import (
        NeckClavicleLandmarks,
        NecklacePocProvider,
    )

    poc = NecklacePocProvider(enabled=True)
    valid_person = _make_portrait_person_image()
    valid_product = _make_necklace_product_image()

    # 1. Unsupported category rejected
    with pytest.raises(VTONValidationError) as exc_cat:
        await poc.process("job-ear", valid_person, valid_product, "EARRINGS")
    assert exc_cat.value.category == "unsupported_category_for_provider"

    # 2. Low-resolution person image (< 160x160) -> unreliable_landmarks
    low_res_person = _make_test_image(color=(210, 170, 145), size=(120, 120), fmt="JPEG")
    with pytest.raises(VTONValidationError) as exc_lowres:
        await poc.process("job-lowres", low_res_person, valid_product, "NECKLACE")
    assert exc_lowres.value.category == "unreliable_landmarks"

    # 3. Uniform/blank person image (no detectable face or neck) -> no_detectable_face_or_neck
    blank_person = _make_test_image(color=(50, 60, 70), size=(300, 400), fmt="JPEG")
    with pytest.raises(VTONValidationError) as exc_noface:
        await poc.process("job-noface", blank_person, valid_product, "NECKLACE")
    assert exc_noface.value.category == "no_detectable_face_or_neck"

    # 4. Non-skin object image -> no_detectable_face_or_neck
    non_skin_img = Image.new("RGB", (300, 400), color=(240, 240, 240))
    for y in range(100, 300):
        for x in range(80, 220):
            non_skin_img.putpixel((x, y), (30, 120, 200))
    ns_buf = io.BytesIO()
    non_skin_img.save(ns_buf, format="JPEG")
    with pytest.raises(VTONValidationError) as exc_nonskin:
        await poc.process("job-nonskin", ns_buf.getvalue(), valid_product, "NECKLACE")
    assert exc_nonskin.value.category == "no_detectable_face_or_neck"

    # 5. Extreme head yaw (> 25 deg) -> unsuitable_pose
    extreme_yaw_person = _make_portrait_person_image(head_shift_x=78)
    with pytest.raises(VTONValidationError) as exc_pose:
        await poc.process("job-pose", extreme_yaw_person, valid_product, "PENDANT")
    assert exc_pose.value.category == "unsuitable_pose"

    # 6. Blank/transparent product image -> segmentation_failure
    empty_prod_img = Image.new("RGBA", (240, 240), color=(0, 0, 0, 0))
    ep_buf = io.BytesIO()
    empty_prod_img.save(ep_buf, format="PNG")
    with pytest.raises(VTONValidationError) as exc_seg_empty:
        await poc.process("job-empty-prod", valid_person, ep_buf.getvalue(), "NECKLACE")
    assert exc_seg_empty.value.category == "segmentation_failure"

    # 7. Cluttered border product image -> segmentation_failure
    import numpy as np

    rng = np.random.default_rng(42)
    noisy_arr = rng.integers(0, 255, size=(240, 240, 3), dtype=np.uint8)
    noisy_buf = io.BytesIO()
    Image.fromarray(noisy_arr, mode="RGB").save(noisy_buf, format="JPEG")
    with pytest.raises(VTONValidationError) as exc_seg_noisy:
        await poc.process("job-noisy-prod", valid_person, noisy_buf.getvalue(), "NECKLACE")
    assert exc_seg_noisy.value.category == "segmentation_failure"

    # 8. Extreme aspect ratio product -> unsupported_necklace_type
    thin_strip_img = Image.new("RGBA", (300, 240), color=(0, 0, 0, 0))
    for y in range(110, 124):
        for x in range(10, 290):
            thin_strip_img.putpixel((x, y), (210, 175, 55, 255))
    ts_buf = io.BytesIO()
    thin_strip_img.save(ts_buf, format="PNG")
    with pytest.raises(VTONValidationError) as exc_aspect:
        await poc.process("job-aspect", valid_person, ts_buf.getvalue(), "NECKLACE")
    assert exc_aspect.value.category == "unsupported_necklace_type"

    # 9. Timeout exceeded -> VTONTimeoutError
    tiny_timeout_poc = NecklacePocProvider(enabled=True, timeout_seconds=-1.0)
    with pytest.raises(VTONTimeoutError):
        await tiny_timeout_poc.process("job-timeout", valid_person, valid_product, "NECKLACE")

    # 10. Low confidence custom landmark detector -> unreliable_landmarks
    def low_conf_detector(_im: Image.Image) -> NeckClavicleLandmarks:
        raise VTONValidationError("Confidence 0.31 < 0.55", category="unreliable_landmarks")

    custom_poc = NecklacePocProvider(enabled=True, landmark_detector=low_conf_detector)
    with pytest.raises(VTONValidationError) as exc_custom:
        await custom_poc.process("job-lowconf", valid_person, valid_product, "NECKLACE")
    assert exc_custom.value.category == "unreliable_landmarks"


@pytest.mark.asyncio
async def test_necklace_poc_provenance_artifacts_and_pilot_integration(tmp_path) -> None:
    """
    Verify Necklace/Pendant PoC output provenance, pixel preservation outside ROI,
    and integration with `scripts/evaluate_vton.py` across the 20-case pilot:
    1. Preserves 100% pixel identity outside the neck/clavicle ROI placement box before JPEG save.
    2. Saves all 6 debug artifacts + side-by-side comparison strip + SHA-256 hashes.
    3. Keeps all 5 human rubric scores blank (`None`).
    4. Enforces mandatory permission gate before loading images.
    5. Zero-cost dry-run with `enable_necklace_poc=True` marks the 5 necklace/pendant
       pilot cases (`PILOT-006`..`PILOT-010`) as `experimental_poc` (`DRY_RUN_MISSING_INPUTS`
       when template paths are unpopulated) while keeping earrings and eyewear as
       `requires_specialized_model`.
    """
    import numpy as np
    from pathlib import Path
    from app.services.necklace_poc_provider import (
        composite_necklace_onto_person,
        detect_neck_clavicle_landmarks,
        estimate_foreground_occlusion_mask,
        segment_jewellery_product,
        warp_and_place_necklace,
    )
    from scripts.evaluate_vton import (
        EvalCase,
        build_adapter_for_provider,
        load_manifest_cases,
        run_evaluation,
    )

    person_bytes = _make_portrait_person_image(size=(320, 420))
    product_bytes = _make_necklace_product_image(size=(260, 220), rgba_transparent=False)

    person_rgb = Image.open(io.BytesIO(person_bytes)).convert("RGB")
    product_img = Image.open(io.BytesIO(product_bytes))

    landmarks = detect_neck_clavicle_landmarks(person_rgb)
    segmented = segment_jewellery_product(product_img)
    warped_rgba, roi_box, _ = warp_and_place_necklace(
        person_size=person_rgb.size,
        segmented=segmented,
        landmarks=landmarks,
        subcategory="NECKLACE",
    )
    occ_mask = estimate_foreground_occlusion_mask(person_rgb, landmarks, roi_box)
    final_rgb, _ = composite_necklace_onto_person(person_rgb, warped_rgba, occ_mask, roi_box)

    # Verify 100% pixel identity outside roi_box
    orig_arr = np.asarray(person_rgb)
    final_arr = np.asarray(final_rgb)
    x0, y0, x1, y1 = roi_box
    outside_mask = np.ones(orig_arr.shape[:2], dtype=bool)
    outside_mask[y0:y1, x0:x1] = False
    assert np.array_equal(orig_arr[outside_mask], final_arr[outside_mask])
    # And inside roi_box, necklace pixels are visibly composited
    assert float(np.mean(np.abs(final_arr[y0:y1, x0:x1].astype(float) - orig_arr[y0:y1, x0:x1].astype(float)))) > 1.0

    # End-to-end evaluation harness run on a consented NECKLACE case
    p_path = tmp_path / "pilot_person.jpg"
    g_path = tmp_path / "pilot_necklace.png"
    p_path.write_bytes(person_bytes)
    g_path.write_bytes(product_bytes)

    poc_adapter = build_adapter_for_provider("necklace-poc", enable_necklace_poc=True)

    # Unconsented case must be rejected before loading images
    unconsented = EvalCase(
        case_id="PILOT-006-NO-PERM",
        title="Unconsented necklace case",
        category="JEWELLERY",
        subcategory="NECKLACE",
        person_condition="Frontal",
        garment_condition="Isolated necklace",
        person_image_path=str(p_path),
        product_image_path=str(g_path),
        image_readiness="ready",
        consent_verified=False,
    )
    blocked_res = await run_evaluation(poc_adapter, [unconsented], tmp_path / "blocked_poc")
    assert blocked_res[0].status == "SKIPPED_OR_ERROR"
    assert blocked_res[0].error_category == "PermissionError"
    assert blocked_res[0].output_path is None

    consented = EvalCase(
        case_id="PILOT-006",
        title="Necklace Pilot #6 — Frontal Clavicle Chain",
        category="JEWELLERY",
        subcategory="NECKLACE",
        person_condition="Frontal neck and clavicle",
        garment_condition="Isolated gold chain with pendant",
        person_image_path=str(p_path),
        product_image_path=str(g_path),
        image_readiness="ready",
        permission_source="user_consented_own_photo",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Synthetic test portrait",
        consent_verified=True,
    )
    eval_res = await run_evaluation(poc_adapter, [consented], tmp_path / "poc_eval_out")
    assert len(eval_res) == 1
    res = eval_res[0]
    assert res.status == "COMPLETED"
    assert res.provider == "necklace-poc"
    assert res.provider_support_status == "experimental_poc"
    assert res.estimated_cost_usd == 0.0
    assert res.person_sha256 is not None and len(res.person_sha256) == 16
    assert res.garment_sha256 is not None and len(res.garment_sha256) == 16
    assert res.raw_output_sha256 is not None and len(res.raw_output_sha256) == 16
    assert res.output_sha256 is not None and len(res.output_sha256) == 16
    assert res.raw_output_path and Path(res.raw_output_path).is_file()
    assert res.mask_output_path and Path(res.mask_output_path).is_file()
    assert res.final_output_path and Path(res.final_output_path).is_file()
    assert res.comparison_strip_path and Path(res.comparison_strip_path).is_file()
    for k in (
        "product_fidelity_1_to_5",
        "placement_and_fit_1_to_5",
        "identity_and_anatomy_preservation_1_to_5",
        "occlusion_and_realism_1_to_5",
        "lighting_pose_and_quality_robustness_1_to_5",
    ):
        assert res.human_rubric_scores[k] is None

    # Zero-cost dry-run across the 20-case pilot manifest with enable_necklace_poc=True
    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    pilot_cases, _ = load_manifest_cases(repo_root / "scripts" / "eval_manifest.pilot20.example.json")
    idm_with_poc = build_adapter_for_provider("idm-vton", enable_necklace_poc=True)
    dry_results = await run_evaluation(
        idm_with_poc,
        pilot_cases,
        tmp_path / "pilot_dry_poc",
        dry_run=True,
    )
    assert len(dry_results) == 20
    assert sum(r.estimated_cost_usd for r in dry_results) == 0.0

    by_subcat_status = [(r.subcategory, r.provider_support_status, r.status) for r in dry_results]
    neck_items = [x for x in by_subcat_status if x[0] in ("NECKLACE", "PENDANT")]
    ear_eye_items = [x for x in by_subcat_status if x[0] in ("EARRINGS", "PRESCRIPTION_GLASSES", "SUNGLASSES")]
    assert len(neck_items) == 5
    assert all(x[1] == "experimental_poc" and x[2] == "DRY_RUN_MISSING_INPUTS" for x in neck_items)
    assert len(ear_eye_items) == 10
    assert all(x[1] == "requires_specialized_model" and x[2] == "requires_specialized_model" for x in ear_eye_items)


@pytest.mark.asyncio
async def test_necklace_poc_landmark_plausibility_and_heuristic_fallback_labeling() -> None:
    """
    Verify Requirement 6 hardening on NecklacePocProvider:
    1. Heuristic contour fallback is explicitly labeled `heuristic_skin_silhouette_fallback`
       with `verified_anatomical=False` and `landmark_detector_warning` in metadata.
    2. Uniform skin-colored rectangle (no shoulder-to-jaw constriction) is rejected as
       `no_detectable_face_or_neck`.
    3. `validate_landmarks_plausibility` rejects NaN coordinates, inverted horizontal
       clavicle/shoulder order, and inverted vertical chin/notch order.
    """
    from app.services.necklace_poc_provider import (
        NeckClavicleLandmarks,
        NecklacePocProvider,
        validate_landmarks_plausibility,
    )

    person_bytes = _make_portrait_person_image()
    product_bytes = _make_necklace_product_image()

    poc = NecklacePocProvider(enabled=True)
    _, _, meta = await poc.process("job-fallback-meta", person_bytes, product_bytes, "NECKLACE")
    assert meta["landmarks"]["detector_backend"] == "heuristic_skin_silhouette_fallback"
    assert meta["landmark_detection_verified"] is False
    assert meta["landmarks"]["verified_anatomical"] is False
    assert "not equivalent to verified anatomical" in meta["landmark_detector_warning"]

    # Uniform skin-colored rectangle (no head/neck constriction) must fail
    skin_block = Image.new("RGB", (320, 420), color=(240, 240, 245))
    from PIL import ImageDraw

    draw = ImageDraw.Draw(skin_block)
    draw.rectangle([60, 40, 260, 380], fill=(215, 165, 135))
    sb_buf = io.BytesIO()
    skin_block.save(sb_buf, format="JPEG")
    with pytest.raises(VTONValidationError) as exc_block:
        await poc.process("job-skin-block", sb_buf.getvalue(), product_bytes, "NECKLACE")
    assert exc_block.value.category == "no_detectable_face_or_neck"

    # Non-finite coordinate check
    nan_lm = NeckClavicleLandmarks(
        chin_xy=(float("nan"), 120.0),
        jaw_left_xy=(110.0, 100.0),
        jaw_right_xy=(210.0, 100.0),
        shoulder_left_xy=(65.0, 185.0),
        shoulder_right_xy=(255.0, 185.0),
        suprasternal_notch_xy=(160.0, 175.0),
        clavicle_left_xy=(115.0, 172.0),
        clavicle_right_xy=(205.0, 172.0),
        shoulder_width_px=190.0,
        yaw_deg=0.0,
        roll_deg=0.0,
        confidence=0.85,
        detector_backend="test",
    )
    with pytest.raises(VTONValidationError) as exc_nan:
        validate_landmarks_plausibility(nan_lm, (320, 420))
    assert exc_nan.value.category == "unreliable_landmarks"

    # Inverted horizontal clavicle order check
    inverted_x_lm = NeckClavicleLandmarks(
        chin_xy=(160.0, 120.0),
        jaw_left_xy=(110.0, 100.0),
        jaw_right_xy=(210.0, 100.0),
        shoulder_left_xy=(65.0, 185.0),
        shoulder_right_xy=(255.0, 185.0),
        suprasternal_notch_xy=(160.0, 175.0),
        clavicle_left_xy=(215.0, 172.0),
        clavicle_right_xy=(105.0, 172.0),
        shoulder_width_px=190.0,
        yaw_deg=0.0,
        roll_deg=0.0,
        confidence=0.85,
        detector_backend="test",
    )
    with pytest.raises(VTONValidationError) as exc_inv_x:
        validate_landmarks_plausibility(inverted_x_lm, (320, 420))
    assert exc_inv_x.value.category == "unreliable_landmarks"

    # Inverted vertical chin vs suprasternal notch check
    inverted_y_lm = NeckClavicleLandmarks(
        chin_xy=(160.0, 210.0),
        jaw_left_xy=(110.0, 100.0),
        jaw_right_xy=(210.0, 100.0),
        shoulder_left_xy=(65.0, 185.0),
        shoulder_right_xy=(255.0, 185.0),
        suprasternal_notch_xy=(160.0, 175.0),
        clavicle_left_xy=(115.0, 172.0),
        clavicle_right_xy=(205.0, 172.0),
        shoulder_width_px=190.0,
        yaw_deg=0.0,
        roll_deg=0.0,
        confidence=0.85,
        detector_backend="test",
    )
    with pytest.raises(VTONValidationError) as exc_inv_y:
        validate_landmarks_plausibility(inverted_y_lm, (320, 420))
    assert exc_inv_y.value.category == "unreliable_landmarks"


def test_necklace_poc_thin_chain_preservation_and_excessive_occlusion() -> None:
    """
    Verify:
    1. Thin 1-2px chain links are preserved during downscaling via MaxFilter alpha reinforcement.
    2. Excessive foreground occlusion (< 30% visible necklace alpha remaining) fails explicitly
       rather than returning a nearly invisible output as success.
    """
    import numpy as np
    from PIL import ImageDraw
    from app.services.necklace_poc_provider import (
        composite_necklace_onto_person,
        detect_neck_clavicle_landmarks,
        segment_jewellery_product,
        warp_and_place_necklace,
    )

    person_rgb = Image.open(io.BytesIO(_make_portrait_person_image(size=(320, 420)))).convert("RGB")
    landmarks = detect_neck_clavicle_landmarks(person_rgb)

    # Create a large product image with a thin 2px chain arc + pendant so it gets downscaled
    thin_prod = Image.new("RGBA", (600, 500), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(thin_prod)
    draw.arc([90, 70, 510, 370], start=0, end=180, fill=(215, 180, 60, 255), width=2)
    draw.ellipse([282, 360, 318, 405], fill=(190, 40, 70, 255), outline=(215, 180, 60, 255), width=2)

    segmented = segment_jewellery_product(thin_prod)
    warped_rgba, roi_box, warp_meta = warp_and_place_necklace(
        person_size=person_rgb.size,
        segmented=segmented,
        landmarks=landmarks,
        subcategory="PENDANT",
    )
    assert warp_meta["target_width_px"] < segmented.rgba_crop.width
    warped_alpha = np.asarray(warped_rgba)[:, :, 3]
    assert int(np.count_nonzero(warped_alpha > 40)) > 80

    # Full occlusion mask (255 everywhere) must fail explicitly
    full_occ = Image.new("L", person_rgb.size, color=255)
    with pytest.raises(VTONValidationError) as exc_occ:
        composite_necklace_onto_person(person_rgb, warped_rgba, full_occ, roi_box)
    assert exc_occ.value.category == "excessive_occlusion"
    assert "occlude" in exc_occ.value.message.lower()


@pytest.mark.asyncio
async def test_decompression_bomb_and_evaluation_hash_and_permission_order(
    monkeypatch, tmp_path
) -> None:
    """
    Verify:
    1. validate_and_encode_image rejects decompression bombs (Image.DecompressionBombError)
       with a clear ImageValidationError.
    2. `run_evaluation` checks `verify_case_permission` BEFORE reading any file on disk.
    3. `run_evaluation` SHA-256 hashes match the exact persisted file contents.
    """
    import hashlib
    from pathlib import Path
    from app.services.image_validator import validate_and_encode_image
    from scripts.evaluate_vton import EvalCase, build_adapter_for_provider, run_evaluation

    # 1. Simulate PIL DecompressionBombError during Image.open
    def raise_bomb(*_args, **_kwargs):
        raise Image.DecompressionBombError("Image size exceeds MAX_IMAGE_PIXELS limit")

    monkeypatch.setattr(Image, "open", raise_bomb)
    with pytest.raises(ImageValidationError, match="maximum safe pixel dimensions"):
        validate_and_encode_image(b"\xff\xd8\xff\xe0" + b"\x00" * 128, label="bomb_image")
    monkeypatch.undo()

    # 2. Verify permission check happens BEFORE file read
    read_attempted = False
    orig_read_bytes = Path.read_bytes

    def spy_read_bytes(self: Path) -> bytes:
        nonlocal read_attempted
        if "secret_unconsented" in str(self):
            read_attempted = True
        return orig_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", spy_read_bytes)

    secret_file = tmp_path / "secret_unconsented.jpg"
    secret_file.write_bytes(_make_test_image())

    unconsented_case = EvalCase(
        case_id="PERM-ORDER-01",
        title="Unconsented file read check",
        category="CLOTHING",
        subcategory="TSHIRT",
        person_condition="Frontal",
        garment_condition="T-shirt",
        person_image_path=str(secret_file),
        product_image_path=str(secret_file),
        image_readiness="ready",
        consent_verified=False,
    )
    mock_adapter = build_adapter_for_provider("mock")
    res_list = await run_evaluation(mock_adapter, [unconsented_case], tmp_path / "perm_out")
    assert res_list[0].status == "SKIPPED_OR_ERROR"
    assert res_list[0].error_category == "PermissionError"
    assert read_attempted is False

    # 3. Verify SHA-256 hashes match actual persisted files
    p_file = tmp_path / "consented_p.jpg"
    g_file = tmp_path / "consented_g.jpg"
    p_bytes = _make_test_image(color=(200, 180, 160), size=(240, 320), fmt="JPEG")
    g_bytes = _make_test_image(color=(40, 100, 190), size=(240, 320), fmt="JPEG")
    p_file.write_bytes(p_bytes)
    g_file.write_bytes(g_bytes)

    consented_case = EvalCase(
        case_id="HASH-VERIFY-01",
        title="Hash verification case",
        category="CLOTHING",
        subcategory="TSHIRT",
        person_condition="Frontal",
        garment_condition="T-shirt",
        person_image_path=str(p_file),
        product_image_path=str(g_file),
        image_readiness="ready",
        permission_source="user_consented_own_photo",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        attribution="Unit test",
        consent_verified=True,
    )
    ok_list = await run_evaluation(mock_adapter, [consented_case], tmp_path / "hash_out")
    ok = ok_list[0]
    assert ok.status == "COMPLETED"
    assert ok.person_sha256 == hashlib.sha256(p_bytes).hexdigest()[:16]
    assert ok.garment_sha256 == hashlib.sha256(g_bytes).hexdigest()[:16]
    assert ok.final_output_path is not None
    final_bytes = Path(ok.final_output_path).read_bytes()
    assert ok.output_sha256 == hashlib.sha256(final_bytes).hexdigest()[:16]

