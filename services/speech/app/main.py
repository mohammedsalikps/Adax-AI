"""ADAXAI local speech service.

Stateless and local by design: it never opens a database and never calls another
service. The API sends it an audio chunk over loopback HTTP and stores the result
itself. It listens on 127.0.0.1 only (set SPEECH_ALLOW_NON_LOOPBACK=1 to run it
elsewhere on purpose), answers only requests addressed to a loopback name (a web
page cannot reach it through a DNS name it controls), and asks for a header that a
browser cannot send to another origin without a pre-flight the service does not
answer. Audio is decoded from memory: uploads are kept in memory (the multipart
parser is told not to spool them to temporary files, and a guard in front of the
application cuts a body off at the size limit and counts requests before any
body is read), and the process logs class names only (a filter removes the
message and traceback that the server would otherwise log for an unhandled
error).

Not a medical device. Nothing here is clinically validated.
"""

from __future__ import annotations

import json
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
from app.engine import AudioTooLong, Engine, InvalidLanguage, ModelLoading, ModelUnavailable, UndecodableAudio, UnsupportedMedia

MAX_AUDIO_BYTES = 64 * 1024 * 1024
#: Requests being served or waiting for the model at once; beyond this the service answers 429 and the caller tries again.
MAX_PENDING = 4
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


#: Room for the multipart envelope (boundaries, part headers, the language field) around the audio itself.
BODY_ENVELOPE = 1024 * 1024
UPLOAD_PATH = "/v1/transcribe"


class RequestGuard:
    """What must be decided before a request body is read, in front of the application (a pure ASGI middleware).

    * Who is asking: a request addressed to anything but a loopback name is refused (DNS rebinding), and a POST must carry the
      local-client header.
    * How large the upload may be: a declared length over the limit is refused without reading a byte, and a body that turns
      out larger (no length declared, or a lie) is cut off at the limit. FastAPI would otherwise parse the whole multipart body,
      and an upload past the parser's memory limit would be written to a temporary file on disk, before the application's own
      size check ran.
    * How many uploads are being handled: counted from the moment the request arrives (not after its body was read) until it is
      answered, so a burst of large uploads is refused with 429 instead of being held in memory.
    """

    def __init__(self, app, *, state, max_pending: int, allow_non_loopback: bool) -> None:  # noqa: ANN001
        self.app = app
        self.state = state
        self.max_pending = max_pending
        self.allow_non_loopback = allow_non_loopback

    @staticmethod
    async def _reply(send, status: int, body: dict[str, str], extra: list[tuple[bytes, bytes]] | None = None) -> None:  # noqa: ANN001
        payload = json.dumps(body).encode()
        headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()), *(extra or [])]
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": payload})

    async def __call__(self, scope, receive, send) -> None:  # noqa: ANN001
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        hosts = [v.decode("latin-1") for k, v in scope["headers"] if k == b"host"]
        if not self.allow_non_loopback and (len(hosts) != 1 or request_host(hosts[0]) not in LOOPBACK):
            await self._reply(send, 403, {"error": "host_not_allowed", "message": "This service answers on this computer only."})
            return
        if scope["method"] == "POST":
            marks = [v.decode("latin-1").strip() for k, v in scope["headers"] if k == LOCAL_HEADER.encode()]
            if marks[:1] != ["1"]:
                await self._reply(send, 403, {"error": "local_header_missing", "message": "Missing the local-client header."})
                return
            if scope["path"] == UPLOAD_PATH:
                await self._upload(scope, receive, send)
                return
        await self.app(scope, receive, send)

    async def _upload(self, scope, receive, send) -> None:  # noqa: ANN001
        # Read at call time, so the limit that is stated is the limit that is enforced.
        limit = MAX_AUDIO_BYTES + BODY_ENVELOPE
        too_large = {"error": "too_large", "message": f"The audio is larger than {MAX_AUDIO_BYTES // (1024 * 1024)} MB."}
        declared = next((v for k, v in scope["headers"] if k == b"content-length"), None)
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                await self._reply(send, 400, {"error": "bad_request", "message": "The request length is not valid."})
                return
            if length > limit:
                await self._reply(send, 413, too_large)
                return
        if self.state.pending >= self.max_pending:
            await self._reply(
                send,
                429,
                {"error": "busy", "message": "The speech service is busy with other recordings. Try again shortly."},
                [(b"retry-after", b"5")],
            )
            return
        self.state.pending += 1
        try:
            total = 0
            cut = False

            async def counted_receive() -> dict[str, Any]:
                nonlocal total, cut
                if cut:
                    return {"type": "http.disconnect"}
                message = await receive()
                if message["type"] == "http.request":
                    total += len(message.get("body", b""))
                    if total > limit:
                        cut = True
                        return {"type": "http.disconnect"}
                return message

            async def quiet_send(message) -> None:  # noqa: ANN001
                # Whatever the application says about a body that was cut off is not sent: the answer is the 413 below.
                if not cut:
                    await send(message)

            try:
                await self.app(scope, counted_receive, quiet_send)
            except Exception:
                if not cut:
                    raise
            if cut:
                await self._reply(send, 413, too_large)
        finally:
            self.state.pending -= 1


def engine_from_env(env: dict[str, str] | None = None) -> Engine:
    e = env if env is not None else os.environ
    return Engine(
        e.get("SPEECH_MODEL_DIR") or None,
        compute_type=e.get("SPEECH_COMPUTE", "int8"),
        cpu_threads=int(e.get("SPEECH_THREADS", "0") or 0),
        max_audio_seconds=float(e.get("SPEECH_MAX_AUDIO_SECONDS", "3600") or 3600),
    )


def create_app(engine: Engine | None = None, *, start: bool = True) -> FastAPI:
    app = FastAPI(title="ADAXAI Speech Service", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine or engine_from_env()
    app.state.pending = 0
    max_pending = int(os.environ.get("SPEECH_MAX_PENDING", str(MAX_PENDING)) or MAX_PENDING)
    allow_non_loopback = os.environ.get("SPEECH_ALLOW_NON_LOOPBACK") == "1"
    for name in ("uvicorn.error", "uvicorn", "adaxai.speech"):
        if not any(isinstance(f, WithholdDetail) for f in logging.getLogger(name).filters):
            logging.getLogger(name).addFilter(WithholdDetail())

    # Everything that must be decided before a request body is read happens here, in front of the application: who is asking,
    # how large the upload may be and how many uploads are already being handled (else the whole body is parsed first).
    app.add_middleware(RequestGuard, state=app.state, max_pending=max_pending, allow_non_loopback=allow_non_loopback)

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

    async def serve(file: UploadFile, language: str | None) -> JSONResponse:
        data = await file.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            return JSONResponse(
                status_code=413,
                content={"error": "too_large", "message": f"The audio is larger than {MAX_AUDIO_BYTES // (1024 * 1024)} MB."},
            )
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
        except UnsupportedMedia:
            return JSONResponse(
                status_code=415,
                content={"error": "unsupported_media", "message": "This is not a WebM, Ogg, WAV, MP3 or MP4 audio file."},
            )
        except AudioTooLong:
            return JSONResponse(
                status_code=413, content={"error": "too_long", "message": "The audio is longer than the service will decode."}
            )
        except UndecodableAudio:
            return JSONResponse(
                status_code=422, content={"error": "undecodable_audio", "message": "The audio could not be decoded."}
            )
        return JSONResponse(content=result)

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
        # The request was counted (and its body capped) by RequestGuard before this function was called.
        return await serve(file, language)

    return app


app = create_app()
