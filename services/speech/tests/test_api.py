from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.engine import Engine
from tests.conftest import FakeModel, Info, Seg, silent_wav

LOCAL = {"x-adaxai-local": "1"}


def local_client(app, **kwargs) -> TestClient:
    """A client that addresses the service as the API does: by a loopback name, with the local-client header."""
    return TestClient(app, base_url="http://127.0.0.1:8002", headers=LOCAL, **kwargs)


def client_for(model: FakeModel | None = None, *, load: bool = True) -> TestClient:
    eng = Engine(None, loader=lambda: model or FakeModel(), runtime="test-runtime", weights_sha256="a" * 64)
    if load:
        eng.load()
    return local_client(main.create_app(eng, start=False))


def post(client: TestClient, data: bytes | None = None, **form):
    return client.post(
        "/v1/transcribe", files={"file": ("chunk.wav", data if data is not None else silent_wav(), "audio/wav")}, data=form
    )


def test_health_says_what_it_is_and_what_it_cannot_do():
    body = client_for().get("/health").json()
    assert body["service"] == "speech" and body["status"] == "ready"
    assert "speaker_identification" in body["notCapable"] and "translation" in body["notCapable"]
    assert body["model"]["local"] is True


def test_health_before_the_model_is_loaded_and_with_no_model():
    assert client_for(load=False).get("/health").json()["status"] == "loading"
    assert local_client(main.create_app(Engine(None), start=False)).get("/health").json()["status"] == "unavailable"


def test_transcribe_returns_segments_language_and_the_model_that_made_them():
    model = FakeModel([Seg(0, 2.5, "I have a cough.", -0.2, 0.01)], Info("en", 0.98, 2.5))
    res = post(client_for(model))
    assert res.status_code == 200
    body = res.json()
    assert body["language"] == "en" and body["model"]["id"] == "faster-whisper-small"
    assert body["segments"][0]["text"] == "I have a cough." and body["segments"][0]["startMs"] == 0


def test_errors_are_json_with_a_code():
    assert post(client_for(load=False)).status_code == 503
    assert post(client_for(load=False)).json()["error"] == "model_loading"
    unavailable = local_client(main.create_app(Engine(None), start=False))
    assert post(unavailable).json()["error"] == "model_unavailable"
    assert post(client_for(), language="not-a-code!").status_code == 400
    assert post(client_for(), data=b"").status_code == 422


def test_audio_larger_than_the_limit_is_refused(monkeypatch):
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 100)
    res = post(client_for(), data=b"x" * 200)
    assert res.status_code == 413 and res.json()["error"] == "too_large"


def test_an_unexpected_failure_is_logged_by_class_name_only(caplog):
    secret = "the patient said something private"
    engine = Engine(None, loader=lambda: FakeModel(error=KeyError(secret)))
    engine.load()
    client = local_client(main.create_app(engine, start=False), raise_server_exceptions=False)
    with caplog.at_level(logging.DEBUG):
        res = post(client)
    assert res.status_code == 500 and res.json() == {"error": "internal_error", "message": "The speech service failed."}
    assert secret not in res.text
    assert secret not in caplog.text and "KeyError" in caplog.text


def test_no_documentation_or_schema_endpoints_are_exposed():
    c = client_for()
    assert [c.get(p).status_code for p in ("/docs", "/redoc", "/openapi.json")] == [404, 404, 404]


@pytest.mark.parametrize(
    ("host", "allow", "ok"),
    [
        ("127.0.0.1", False, True),
        ("::1", False, True),
        ("localhost", False, True),
        ("0.0.0.0", False, False),
        ("192.168.1.5", False, False),
        ("192.168.1.5", True, True),
    ],
)
def test_the_service_listens_on_loopback_unless_told_otherwise(host, allow, ok):
    assert main.host_is_allowed(host, allow) is ok


def test_a_request_addressed_to_another_host_name_is_refused(monkeypatch):
    """DNS rebinding: a page at evil.example pointing its name at 127.0.0.1 sends Host: evil.example."""
    monkeypatch.delenv("SPEECH_ALLOW_NON_LOOPBACK", raising=False)
    c = client_for()
    for host in ("evil.example", "evil.example:8002", "192.168.1.5:8002", "127.0.0.1.evil.example"):
        assert c.get("/health", headers={"host": host}).status_code == 403
        r = c.post("/v1/transcribe", files={"file": ("a.wav", silent_wav(), "audio/wav")}, headers={"host": host})
        assert r.status_code == 403 and r.json()["error"] == "host_not_allowed"
    for host in ("127.0.0.1:8002", "localhost:8002", "[::1]:8002", "LOCALHOST"):
        assert c.get("/health", headers={"host": host}).status_code == 200


def test_a_post_without_the_local_client_header_is_refused():
    """A page cannot add a custom header to a cross-origin request without a pre-flight, which this service never answers."""
    c = client_for()
    r = c.post("/v1/transcribe", files={"file": ("a.wav", silent_wav(), "audio/wav")}, headers={"x-adaxai-local": ""})
    assert r.status_code == 403 and r.json()["error"] == "local_header_missing"
    assert (
        c.options(
            "/v1/transcribe", headers={"origin": "https://evil.example", "access-control-request-method": "POST"}
        ).headers.get("access-control-allow-origin")
        is None
    )


def test_uploads_are_kept_in_memory_not_spooled_to_temporary_files():
    from starlette.formparsers import MultiPartParser

    assert MultiPartParser.spool_max_size >= main.MAX_AUDIO_BYTES


@pytest.fixture
def parse_spy(monkeypatch):
    """Records whether the multipart body was handed to the parser (the step that would hold it in memory or spool it to disk)."""
    from starlette.formparsers import MultiPartParser

    seen = {"parsed": 0}
    real = MultiPartParser.parse

    async def spy(self):
        seen["parsed"] += 1
        return await real(self)

    monkeypatch.setattr(MultiPartParser, "parse", spy)
    return seen


def test_an_upload_over_the_limit_is_refused_before_its_body_is_parsed_and_leaves_nothing_on_disk(
    monkeypatch, tmp_path, parse_spy
):
    import tempfile

    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 1024)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    c = client_for()
    # Declared length (the client states how long the body is): refused without reading it.
    res = post(c, b"x" * (3 * 1024 * 1024))
    assert res.status_code == 413 and res.json()["error"] == "too_large"
    assert parse_spy["parsed"] == 0
    assert c.app.state.pending == 0
    assert list(tmp_path.iterdir()) == []


def test_a_body_that_declares_no_length_is_cut_off_at_the_limit_too(monkeypatch, tmp_path, parse_spy):
    import tempfile

    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 1024)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    read = {"bytes": 0}

    def stream():
        yield b'--b\r\ncontent-disposition: form-data; name="file"; filename="a.wav"\r\ncontent-type: audio/wav\r\n\r\n'
        for _ in range(200):  # 12.5 MiB offered; the limit is 1 MiB and a bit
            read["bytes"] += 65536
            yield b"x" * 65536
        yield b"\r\n--b--\r\n"

    c = client_for()
    res = c.post("/v1/transcribe", content=stream(), headers={"content-type": "multipart/form-data; boundary=b"})
    assert "content-length" not in res.request.headers  # the length was not declared: only counting the bytes can stop it
    assert res.status_code == 413 and res.json()["error"] == "too_large"
    assert parse_spy["parsed"] == 1  # it was handed to the parser, which stopped when the guard cut the body off
    assert c.app.state.pending == 0
    assert list(tmp_path.iterdir()) == []


def test_a_request_is_counted_before_its_body_is_read_so_a_burst_of_uploads_is_refused_not_held(parse_spy):
    c = client_for()
    c.app.state.pending = main.MAX_PENDING
    res = post(c, silent_wav(2.0))
    assert res.status_code == 429 and res.headers["retry-after"] == "5"
    assert parse_spy["parsed"] == 0
    assert c.app.state.pending == main.MAX_PENDING
    c.app.state.pending = 0


def test_an_upload_within_the_limit_never_touches_the_disk(monkeypatch, tmp_path):
    import tempfile

    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 2 * 1024 * 1024)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    res = post(client_for(), silent_wav(40.0))  # 1.25 MiB: over Starlette's own 1 MiB spooling default
    assert res.status_code == 200
    assert list(tmp_path.iterdir()) == []


def test_the_server_error_log_cannot_carry_an_exception_message_or_traceback():
    secret = "words the patient said"
    logger = logging.getLogger("uvicorn.error")
    main.create_app(Engine(None), start=False)
    assert any(isinstance(f, main.WithholdDetail) for f in logger.filters)
    try:
        raise KeyError(secret)
    except KeyError:
        import sys

        record = logger.makeRecord(
            "uvicorn.error", logging.ERROR, __file__, 1, "Exception in ASGI application", (), sys.exc_info()
        )
    assert all(f.filter(record) for f in logger.filters)
    text = logging.Formatter("%(message)s").format(record)
    assert secret not in text and "Traceback" not in text and "withheld" in text


def test_host_header_parsing():
    assert [main.request_host(h) for h in ("127.0.0.1:8002", "[::1]:8002", "Localhost", None, "")] == [
        "127.0.0.1",
        "::1",
        "localhost",
        "",
        "",
    ]
