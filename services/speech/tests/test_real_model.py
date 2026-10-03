"""Runs only where the real model has been downloaded (npm run speech:model). Uses no audio of anyone: two seconds of silence."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.conftest import silent_wav

MODEL_DIR = Path(
    os.environ.get("SPEECH_MODEL_DIR") or Path(__file__).resolve().parents[3] / ".data" / "models" / "faster-whisper-small"
)

pytestmark = pytest.mark.skipif(not (MODEL_DIR / "model.bin").is_file(), reason="the speech model is not installed")


def test_the_real_model_loads_offline_and_hears_nothing_in_silence():
    from app.engine import Engine

    engine = Engine(MODEL_DIR)
    engine.load()
    assert engine.state == "ready", engine.status()
    out = engine.transcribe(silent_wav(2.0))
    assert out["segments"] == []
    assert out["model"]["weightsSha256"] == "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"
