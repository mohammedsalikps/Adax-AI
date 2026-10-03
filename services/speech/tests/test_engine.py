from __future__ import annotations

import math
import socket

import pytest

from app.engine import Engine, InvalidLanguage, ModelLoading, ModelUnavailable, UndecodableAudio
from tests.conftest import FakeModel, Info, Seg, silent_wav


def test_a_new_engine_without_a_model_says_unavailable_and_why(tmp_path):
    engine = Engine(None)
    assert engine.state == "unavailable"
    assert "SPEECH_MODEL_DIR" in engine.status()["reason"]
    with pytest.raises(ModelUnavailable):
        engine.transcribe(b"x")
    # A directory without model files is reported as such, never loaded.
    assert Engine(tmp_path).state == "unavailable"


def test_loading_then_ready(make_engine):
    engine = make_engine(load=False)
    assert engine.state == "loading"
    with pytest.raises(ModelLoading):
        engine.transcribe(b"x")
    engine.load()
    assert engine.status()["status"] == "ready"
    assert engine.status()["model"]["local"] is True
    assert engine.status()["model"]["weightsSha256"] == "0" * 64


def test_a_model_that_fails_to_load_is_failed_and_the_reason_has_no_message():
    def boom():
        raise RuntimeError("secret path C:/somewhere")

    engine = Engine(None, loader=boom)
    engine.load()
    assert engine.state == "failed"
    assert "RuntimeError" in engine.status()["reason"]
    assert "secret" not in engine.status()["reason"]


def test_segments_are_mapped_ordered_and_scored_from_what_the_model_reported(make_engine):
    model = FakeModel(
        [
            Seg(3.1, 6.99, " I am allergic to penicillin. ", -0.5, 0.01),
            Seg(0.0, 3.11, "I have had a fever.", -0.1215, 0.0029),
            Seg(7.0, 7.5, "   ", -0.2, 0.0),  # empty after trimming: dropped, never invented
        ],
        Info("en", 0.99754, 7.725),
    )
    out = make_engine(model).transcribe(silent_wav())
    assert [s["text"] for s in out["segments"]] == ["I have had a fever.", "I am allergic to penicillin."]
    first = out["segments"][0]
    assert (first["startMs"], first["endMs"]) == (0, 3110)
    assert first["avgLogprob"] == -0.1215 and first["noSpeechProb"] == 0.0029
    assert first["confidence"] == round(math.exp(-0.1215), 3)
    assert out["confidenceKind"] == "mean_token_probability"
    assert out["language"] == "en" and out["languageSource"] == "detected" and out["durationMs"] == 7725
    assert out["speakers"] == "not_identified"


def test_the_task_is_always_transcribe_never_translate(make_engine):
    model = FakeModel([Seg(0, 1, "namaste", -0.3, 0.0)], Info("hi", 0.9, 1.0))
    engine = make_engine(model)
    engine.transcribe(silent_wav())
    engine.transcribe(silent_wav(), "hi")
    assert {c["task"] for c in model.calls} == {"transcribe"}
    assert model.calls[1]["language"] == "hi"
    # Nothing may carry the earlier chunk's words into the next one.
    assert all(c["condition_on_previous_text"] is False for c in model.calls)


def test_a_language_hint_is_reported_as_a_hint_not_a_detection(make_engine):
    out = make_engine(FakeModel([Seg(0, 1, "x", -0.1, 0.0)])).transcribe(silent_wav(), "en")
    assert out["languageSource"] == "hint"


def test_confidence_stays_inside_zero_and_one(make_engine):
    out = make_engine(FakeModel([Seg(0, 1, "x", 0.5, 0.0), Seg(1, 2, "y", -50.0, 0.0)])).transcribe(silent_wav())
    assert [s["confidence"] for s in out["segments"]] == [1.0, 0.0]


def test_an_unknown_language_and_undecodable_audio_are_told_apart(make_engine):
    with pytest.raises(InvalidLanguage):
        make_engine(FakeModel(error=ValueError("'zz' is not a valid language code"))).transcribe(silent_wav(), "zz")

    class AvError(Exception):
        pass

    AvError.__module__ = "av.error"
    with pytest.raises(UndecodableAudio):
        make_engine(FakeModel(error=AvError("bad data"))).transcribe(silent_wav())
    # Anything else is not swallowed.
    with pytest.raises(KeyError):
        make_engine(FakeModel(error=KeyError("other"))).transcribe(silent_wav())


def test_transcribing_opens_no_network_connection(make_engine, monkeypatch):
    attempts: list[object] = []
    real = socket.socket.connect

    def guard(self, address):
        attempts.append(address)
        host = address[0] if isinstance(address, tuple) else address
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise AssertionError(f"non-loopback connection attempted: {address!r}")
        return real(self, address)

    monkeypatch.setattr(socket.socket, "connect", guard)
    make_engine(FakeModel([Seg(0, 1, "hello", -0.1, 0.0)])).transcribe(silent_wav())
    assert attempts == []


def test_the_hub_is_switched_off_before_anything_can_reach_it():
    import os

    import app.engine  # noqa: F401

    assert os.environ["HF_HUB_OFFLINE"] == "1"


def test_a_model_file_that_is_not_the_pinned_one_is_not_loaded(tmp_path):
    import json
    from hashlib import sha256

    from app.engine import Engine, pinned_weights_sha256

    (tmp_path / "model.bin").write_bytes(b"not the pinned weights")
    lock = tmp_path / "models.lock.json"
    lock.write_text(json.dumps({"files": [{"name": "model.bin", "sha256": sha256(b"the pinned weights").hexdigest()}]}))
    assert pinned_weights_sha256(lock) == sha256(b"the pinned weights").hexdigest()
    engine = Engine(tmp_path, lock_file=lock)
    engine.load()
    assert engine.state == "failed"
    assert "checksum" in engine.status()["reason"]


def test_the_packaged_lock_pins_the_published_weights():
    from app.engine import pinned_weights_sha256

    assert pinned_weights_sha256() == "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"
