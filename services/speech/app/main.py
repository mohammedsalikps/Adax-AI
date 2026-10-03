"""ADAXAI local speech service.

Stateless and local by design: it never opens a database and never calls another
service. The API sends it an audio chunk over loopback HTTP and stores the result
itself. It listens on 127.0.0.1 only (set SPEECH_ALLOW_NON_LOOPBACK=1 to run it
elsewhere on purpose), answers only requests addressed to a loopback name (a web
page cannot reach it through a DNS name it controls), and asks for a header that a
browser cannot send to another origin without a pre-flight the service does not
answer. Audio is decoded from memory: uploads are kept in memory (the multipart
parser is told not to spool them to temporary files), and the process logs class
names only (a filter removes the message and traceback that the server would
otherwise log for an unhandled error).

Not a medical device. Nothing here is clinically validated.
"""

from __future__ import annotations

import logging
import os
import platform
import re
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.formparsers import MultiPartParser

from app import __version__
from app.engine import Engine, InvalidLanguage, ModelLoading, ModelUnavailable, UndecodableAudio

MAX_AUDIO_BYTES = 100 * 1024 * 1024
LANGUAGE_RE = re.compile(r"^[a-z]{2,3}$")
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
#: The API sends this on every transcription request. A web page cannot add a custom header to a request to another
#: origin without a pre-flight, and the service answers none, so a page in the doctor's browser cannot use the service.
LOCAL_HEADER = "x-adaxai-local"

# Uploads stay in memory: Starlette would otherwise spool anything over 1 MiB to a temporary file (audio on disk).
MultiPartParser.spool_max_size = MAX_AUDIO_BYTES + 1024 * 1024

log = logging.getLogger("adaxai.speech")


def host_is_allowed(host: str, allow_non_loopback: bool) -> bool:
    return allow_non_loopback or host in LOOPBACK


def request_host(header: str | None) -> str:
    """The hostname of a Host header, without its port ("[::1]:8002" -> "::1")."""
    h = (header or "").strip().lower()
    if h.startswith("["):
        return h[1 : h.find("]")] if "]" in h else h
    return h.split(":", 1)[0]


class WithholdDetail(logging.Filter):
    """Server error logs would carry an exception's message and traceback (request data): they become a notice."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.exc_info or record.exc_text:
            record.msg = "unhandled error in the speech service (details withheld: they may hold request data)"
            record.args = ()
            record.exc_info = None
            record.exc_text = None
        return True


def engine_from_env(env: dict[str, str] | None = None) -> Engine:
    e = env if env is not None else os.environ
    return Engine(
        e.get("SPEECH_MODEL_DIR") or None,
        compute_type=e.get("SPEECH_COMPUTE", "int8"),
        cpu_threads=int(e.get("SPEECH_THREADS", "0") or 0),
    )


def create_app(engine: Engine | None = None, *, start: bool = True) -> FastAPI:
    app = FastAPI(title="ADAXAI Speech Service", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine or engine_from_env()
    allow_non_loopback = os.environ.get("SPEECH_ALLOW_NON_LOOPBACK") == "1"
    for name in ("uvicorn.error", "uvicorn", "adaxai.speech"):
        if not any(isinstance(f, WithholdDetail) for f in logging.getLogger(name).filters):
            logging.getLogger(name).addFilter(WithholdDetail())

    @app.middleware("http")
    async def local_only(request: Request, call_next):  # noqa: ANN001, ANN202
        if not allow_non_loopback and request_host(request.headers.get("host")) not in LOOPBACK:
            return JSONResponse(
                status_code=403, content={"error": "host_not_allowed", "message": "This service answers on this computer only."}
            )
        if request.method == "POST" and request.headers.get(LOCAL_HEADER) != "1":
            return JSONResponse(
                status_code=403, content={"error": "local_header_missing", "message": "Missing the local-client header."}
            )
        return await call_next(request)

    if start:
        app.state.engine.start_loading()

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        # The class name only: an exception message could carry request data.
        log.error("unhandled %s", type(exc).__name__)
        return JSONResponse(status_code=500, content={"error": "internal_error", "message": "The speech service failed."})

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "service": "speech",
            "version": __version__,
            "python": platform.python_version(),
            "capabilities": ["transcribe", "language_detection", "segment_timestamps"],
            "notCapable": ["speaker_identification", "translation"],
            **app.state.engine.status(),
        }

    @app.post("/v1/transcribe")
    async def transcribe(
        file: Annotated[UploadFile, File()],
        language: Annotated[str | None, Form()] = None,
    ) -> JSONResponse:
        if language is not None:
            language = language.strip().lower() or None
        if language is not None and not LANGUAGE_RE.match(language):
            return JSONResponse(
                status_code=400, content={"error": "invalid_language", "message": "Use a two or three letter language code."}
            )
        data = await file.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            return JSONResponse(status_code=413, content={"error": "too_large", "message": "The audio is larger than 100 MB."})
        if not data:
            return JSONResponse(status_code=422, content={"error": "undecodable_audio", "message": "The audio is empty."})
        try:
            result = await run_in_threadpool(app.state.engine.transcribe, data, language)
        except ModelLoading:
            return JSONResponse(
                status_code=503, content={"error": "model_loading", "message": "The speech model is still loading."}
            )
        except ModelUnavailable as e:
            return JSONResponse(status_code=503, content={"error": "model_unavailable", "message": str(e)})
        except InvalidLanguage:
            return JSONResponse(
                status_code=400, content={"error": "invalid_language", "message": "The model does not know this language."}
            )
        except UndecodableAudio:
            return JSONResponse(
                status_code=422, content={"error": "undecodable_audio", "message": "The audio could not be decoded."}
            )
        return JSONResponse(content=result)

    return app


app = create_app()
