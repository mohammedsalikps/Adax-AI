"""Uploaded audio is judged by its content, opened only by the demuxer we pick, and bounded before it is decoded."""

from __future__ import annotations

import io
import wave

import numpy as np
import pytest

import app.main as main
import app.media as media
from app.engine import Engine
from tests.conftest import FakeModel, silent_wav
from tests.test_api import LOCAL, local_client

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 16
PLAYLIST = b"#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nhttp://169.254.169.254/latest/meta-data/\n#EXT-X-ENDLIST\n"
CONCAT = b"ffconcat version 1.0\nfile '/etc/passwd'\nfile 'http://127.0.0.1:4000/api/health'\n"


def tone_wav(seconds: float) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        t = np.arange(int(16000 * seconds)) / 16000
        w.writeframes((np.sin(2 * np.pi * 440 * t) * 8000).astype("<i2").tobytes())
    return buf.getvalue()


def client(max_audio_seconds: float = 3600.0):
    engine = Engine(None, loader=lambda: FakeModel(), runtime="t", weights_sha256="a" * 64, max_audio_seconds=max_audio_seconds)
    engine.load()
    return local_client(main.create_app(engine, start=False))


def post(c, data: bytes, name: str = "a.wav", mime: str = "audio/wav"):
    return c.post("/v1/transcribe", files={"file": (name, data, mime)})


@pytest.mark.parametrize(
    ("head", "kind"),
    [
        (WEBM, "webm"),
        (b"OggS" + b"\x00" * 12, "ogg"),
        (b"RIFF\x24\x00\x00\x00WAVEfmt ", "wav"),
        (b"ID3\x04" + b"\x00" * 12, "mp3"),
        (b"\xff\xfb\x90\x00" + b"\x00" * 12, "mp3"),
        (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 12, "mp4"),
    ],
)
def test_the_content_decides_what_kind_of_audio_it_is(head, kind):
    assert media.sniff(head) == kind


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"hello",
        b"hello world, not audio at all",
        PLAYLIST,
        CONCAT,
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 8,
        b"PK\x03\x04" + b"\x00" * 12,
        b"#!/bin/sh\necho hi\n",
    ],
)
def test_anything_else_is_not_audio(data):
    assert media.sniff(data) is None


def test_a_file_that_is_not_audio_is_refused_whatever_it_is_called_or_declared_to_be():
    c = client()
    for data, name, mime in [
        (b"this is a text file", "a.wav", "audio/wav"),
        (PLAYLIST, "playlist.webm", "audio/webm"),
        (CONCAT, "x.mp3", "audio/mpeg"),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "photo.wav", "audio/wav"),
    ]:
        r = post(c, data, name, mime)
        assert r.status_code == 415 and r.json()["error"] == "unsupported_media", name
    assert post(c, silent_wav(), "whatever.txt", "text/plain").status_code == 200


def test_the_demuxer_is_the_one_for_the_sniffed_kind_and_nothing_else_can_be_read_through_it(monkeypatch):
    import av

    seen: dict = {}
    real = av.open

    def spy(*args, **kwargs):
        seen.update(kwargs)
        return real(*args, **kwargs)

    monkeypatch.setattr(av, "open", spy)
    media.decode_bounded(silent_wav(0.5), 10)
    assert seen["format"] == "wav"
    assert seen["options"] == {"protocol_whitelist": "data"}


def _open_concat(script: bytes, options: dict[str, str]):
    """Opens a concatenation list with the demuxer forced (as if the content check were bypassed) and reads what it names."""
    import av

    container = av.open(io.BytesIO(script), mode="r", format="concat", options=options)
    try:
        return sum(1 for _ in container.demux())
    finally:
        container.close()


def test_the_protocol_whitelist_stops_an_upload_from_reading_a_file_even_if_the_content_check_were_bypassed(tmp_path):
    """The whitelist is tested on its own: a concatenation list naming a real file is read with a permissive whitelist (the
    control: the test can see the difference) and refused with the one the service uses."""
    secret = tmp_path / "other.wav"
    secret.write_bytes(silent_wav(0.5))
    script = f"ffconcat version 1.0\nfile '{secret.as_posix()}'\n".encode()
    # safe=0 lets the list name an absolute path at all; without the whitelist the file is opened and read.
    assert _open_concat(script, {"safe": "0", "protocol_whitelist": "file,data"}) > 0
    with pytest.raises(Exception):  # noqa: B017, PT011 - FFmpeg's own error type differs by version; what matters is that it is refused
        _open_concat(script, {"safe": "0", **media.DEMUX_OPTIONS})


def test_the_protocol_whitelist_stops_an_upload_from_making_the_service_call_an_address():
    """The same, for the network: a local server counts the requests a concatenation list makes it; the service lets none by."""
    import http.server
    import threading

    hits: list[str] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            hits.append(self.path)
            body = silent_wav(0.5)
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:  # noqa: ANN002
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        script = f"ffconcat version 1.0\nfile 'http://127.0.0.1:{server.server_address[1]}/probe.wav'\n".encode()
        with pytest.raises(Exception):  # noqa: B017, PT011
            _open_concat(script, {"safe": "0", **media.DEMUX_OPTIONS})
        assert hits == [], "the service's whitelist let an upload reach an address"
        # The control: with the network protocols allowed, the same list does make the request.
        _open_concat(script, {"safe": "0", "protocol_whitelist": "http,tcp,data"})
        assert hits, "the control did not reach the local server, so this test cannot tell the difference"
    finally:
        server.shutdown()


def test_a_wav_header_followed_by_junk_is_undecodable_not_a_crash():
    junk = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\xff" * 64
    r = post(client(), junk)
    assert r.status_code == 422 and r.json()["error"] == "undecodable_audio"


def test_audio_longer_than_the_bound_is_refused_from_its_declared_length_before_any_decoding(monkeypatch):
    import av

    class NeverUsed:
        def __init__(self, *args, **kwargs):
            raise AssertionError("the audio was being decoded")

    monkeypatch.setattr(av.audio.resampler, "AudioResampler", NeverUsed)
    monkeypatch.setattr(media, "declared_seconds", lambda container: 9999.0)
    r = post(client(max_audio_seconds=2.0), tone_wav(1.0))
    assert r.status_code == 413 and r.json()["error"] == "too_long"


def test_a_container_that_declares_no_length_is_decoded_in_a_stream_that_stops_at_the_bound(monkeypatch):
    monkeypatch.setattr(media, "declared_seconds", lambda container: None)
    c = client(max_audio_seconds=2.0)
    long_audio = tone_wav(6.0)
    r = post(c, long_audio)
    assert r.status_code == 413 and r.json()["error"] == "too_long"
    # And a short one in the same condition passes.
    assert post(c, tone_wav(1.0)).status_code == 200


def test_the_decode_stops_at_the_bound_it_does_not_run_to_the_end_and_measure(monkeypatch):
    """Counts the frames that went through the resampler: the same audio, once with room and once with a 2-second bound."""
    import av

    monkeypatch.setattr(media, "declared_seconds", lambda container: None)
    seen = {"frames": 0}
    real_class = av.audio.resampler.AudioResampler

    class Counting:
        """The real resampler (a compiled type that cannot be patched), counting the frames it is given."""

        def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
            self._real = real_class(*args, **kwargs)

        def resample(self, frame):  # noqa: ANN001, ANN202
            if frame is not None:
                seen["frames"] += 1
            return self._real.resample(frame)

    monkeypatch.setattr(av.audio.resampler, "AudioResampler", Counting)
    audio = tone_wav(30.0)
    media.decode_bounded(audio, 100.0)
    everything = seen["frames"]
    seen["frames"] = 0
    with pytest.raises(media.AudioTooLong):
        media.decode_bounded(audio, 2.0)
    assert everything > 20, "the control must decode a good many frames"
    assert seen["frames"] <= everything / 5, f"{seen['frames']} of {everything} frames were decoded before the bound stopped it"


def test_it_decodes_what_it_should(monkeypatch):
    samples = media.decode_bounded(tone_wav(1.0), 10)
    assert samples.dtype == np.float32 and 15900 <= samples.shape[0] <= 16100
    assert float(np.abs(samples).max()) > 0.1 and float(np.abs(samples).max()) <= 1.0


def test_too_many_requests_at_once_get_429_and_a_time_to_come_back():
    c = client()
    c.app.state.pending = main.MAX_PENDING
    r = post(c, silent_wav())
    assert r.status_code == 429 and r.json()["error"] == "busy" and r.headers["retry-after"] == "5"
    # The count goes down again as requests finish, even failed ones.
    c.app.state.pending = 0
    assert post(c, b"not audio at all").status_code == 415
    assert c.app.state.pending == 0
    assert post(c, silent_wav()).status_code == 200
    assert c.app.state.pending == 0


def test_the_size_limit_is_stated_and_enforced(monkeypatch):
    monkeypatch.setattr(main, "MAX_AUDIO_BYTES", 1024)
    r = post(client(), silent_wav(1.0))
    assert r.status_code == 413 and r.json()["error"] == "too_large"


def test_the_local_header_is_still_needed():
    c = client()
    assert LOCAL["x-adaxai-local"] == "1"
    assert (
        c.post("/v1/transcribe", files={"file": ("a.wav", silent_wav(), "audio/wav")}, headers={"x-adaxai-local": ""}).status_code
        == 403
    )
