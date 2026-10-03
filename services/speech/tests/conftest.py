from __future__ import annotations

import wave
from collections import namedtuple
from io import BytesIO

import pytest

Seg = namedtuple("Seg", "start end text avg_logprob no_speech_prob")
Info = namedtuple("Info", "language language_probability duration")


class FakeModel:
    """Stands in for faster_whisper.WhisperModel: records how it was called, returns what the test gave it."""

    def __init__(self, segments=None, info=None, error: Exception | None = None):
        self.segments = segments if segments is not None else []
        self.info = info or Info("en", 0.99, 5.0)
        self.error = error
        self.calls: list[dict] = []

    def transcribe(self, audio, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return iter(self.segments), self.info


def silent_wav(seconds: float = 1.0) -> bytes:
    buf = BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))
    return buf.getvalue()


@pytest.fixture
def make_engine():
    from app.engine import Engine

    def make(model: FakeModel | None = None, *, load: bool = True):
        engine = Engine(None, loader=(lambda: model or FakeModel()), runtime="test-runtime", weights_sha256="0" * 64)
        if load:
            engine.load()
        return engine

    return make
