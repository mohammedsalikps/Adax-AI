"""Local speech-to-text engine: faster-whisper (CTranslate2) on this machine.

What this module guarantees, and tests check:

* No network. The model is read from a directory on disk (never fetched), the
  hub is switched to offline mode before anything is imported, and nothing here
  opens a socket.
* No audio on disk. The uploaded bytes are decoded from memory, by a decoder we pick for the sniffed container,
  and never beyond a bounded length (app/media.py).
* No translation. The task is always "transcribe": the words are what was said,
  in the language that was said.
* No invented numbers. `avgLogprob` and `noSpeechProb` are what the model reports.
  `confidence` is exp(avgLogprob), the geometric mean of the probabilities the model
  gave its own words: a model score, not a calibrated probability that the text is
  right, and it is named as such in every response.

The service does not identify speakers: it has no diariser, and says so.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.media import AudioTooLong, UndecodableAudio, UnsupportedMedia, decode_bounded

# Before any import that could reach the model hub.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

__all__ = [
    "AudioTooLong",
    "Engine",
    "InvalidLanguage",
    "ModelLoading",
    "ModelUnavailable",
    "UndecodableAudio",
    "UnsupportedMedia",
]

MODEL_ID = "faster-whisper-small"
CONFIDENCE_KIND = "mean_token_probability"


class ModelUnavailable(Exception):
    """No model directory, or it failed to load."""


class ModelLoading(Exception):
    """The model is still being read from disk."""


class InvalidLanguage(Exception):
    """The model does not know this language code."""


class WeightsMismatch(Exception):
    """The model file is not the one pinned in models.lock.json."""


LOCK_FILE = Path(__file__).resolve().parent.parent / "models.lock.json"


def pinned_weights_sha256(lock_file: Path = LOCK_FILE) -> str | None:
    """The SHA-256 the lock file pins for model.bin, or None if there is no lock (a custom model directory)."""
    try:
        lock = json.loads(lock_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for f in lock.get("files", []):
        if f.get("name") == "model.bin":
            return str(f.get("sha256") or "") or None
    return None


@dataclass(frozen=True)
class ModelInfo:
    id: str
    runtime: str
    compute_type: str
    device: str
    weights_sha256: str | None
    multilingual: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "runtime": self.runtime,
            "computeType": self.compute_type,
            "device": self.device,
            "weightsSha256": self.weights_sha256,
            "multilingual": self.multilingual,
            "local": True,
        }


def sha256_file(path: Path, block: int = 4 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(block):
            h.update(chunk)
    return h.hexdigest()


def _runtime_version() -> str:
    try:
        import ctranslate2
        import faster_whisper

        return f"faster-whisper {faster_whisper.__version__} / ctranslate2 {ctranslate2.__version__}"
    except Exception:  # noqa: BLE001 - only used to describe the runtime
        return "faster-whisper (version unknown)"


def real_loader(model_dir: Path, compute_type: str, cpu_threads: int) -> Callable[[], Any]:
    def load() -> Any:
        from faster_whisper import WhisperModel

        # A path, not a model name: faster-whisper then never contacts the hub.
        return WhisperModel(str(model_dir), device="cpu", compute_type=compute_type, cpu_threads=cpu_threads)

    return load


class Engine:
    """Owns the model, loads it once in the background, and runs one transcription at a time."""

    def __init__(
        self,
        model_dir: str | os.PathLike[str] | None,
        *,
        compute_type: str = "int8",
        cpu_threads: int = 0,
        loader: Callable[[], Any] | None = None,
        runtime: str | None = None,
        weights_sha256: str | None = None,
        model_id: str = MODEL_ID,
        lock_file: Path | None = None,
        max_audio_seconds: float = 3600.0,
    ) -> None:
        self._lock_file = lock_file or LOCK_FILE
        self._max_audio_seconds = max_audio_seconds
        self._dir = Path(model_dir) if model_dir else None
        self._compute = compute_type
        self._threads = cpu_threads
        self._loader = loader
        self._runtime = runtime
        self._weights = weights_sha256
        self._model_id = model_id
        self._model: Any = None
        self._state = "unavailable"
        self._reason: str | None = "No model directory is configured (SPEECH_MODEL_DIR)."
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        if loader is not None:
            self._state, self._reason = "loading", None
        elif self._dir is not None and (self._dir / "model.bin").is_file():
            self._state, self._reason = "loading", None
        elif self._dir is not None:
            self._reason = f"The model files are not at {self._dir.name}/ (run `npm run speech:model`)."

    # -- loading ---------------------------------------------------------------------------------------------

    def start_loading(self) -> threading.Thread | None:
        if self._state != "loading":
            return None
        t = threading.Thread(target=self.load, name="speech-model-load", daemon=True)
        t.start()
        return t

    def load(self) -> None:
        try:
            loader = self._loader or real_loader(self._dir, self._compute, self._threads)  # type: ignore[arg-type]
            if self._loader is None and self._weights is None and self._dir is not None:
                self._weights = sha256_file(self._dir / "model.bin")
                # Checked against the pinned checksum before use: a swapped or damaged file is not loaded.
                pinned = pinned_weights_sha256(self._lock_file)
                if pinned and pinned != self._weights:
                    raise WeightsMismatch
            model = loader()
            with self._state_lock:
                self._model, self._state, self._reason = model, "ready", None
        except WeightsMismatch:
            with self._state_lock:
                self._state = "failed"
                self._reason = (
                    "The model file does not match the checksum pinned in models.lock.json, so it was not loaded "
                    "(run `npm run speech:model`)."
                )
        except Exception as e:  # noqa: BLE001 - reported by class name only, never with data
            with self._state_lock:
                self._state = "failed"
                self._reason = f"The model could not be loaded ({type(e).__name__})."

    # -- status ----------------------------------------------------------------------------------------------

    @property
    def state(self) -> str:
        return self._state

    def info(self) -> ModelInfo:
        return ModelInfo(
            id=self._model_id,
            runtime=self._runtime or _runtime_version(),
            compute_type=self._compute,
            device="cpu",
            weights_sha256=self._weights,
            multilingual=True,
        )

    def status(self) -> dict[str, Any]:
        out: dict[str, Any] = {"status": self._state, "model": self.info().as_dict()}
        if self._reason:
            out["reason"] = self._reason
        return out

    # -- transcription ---------------------------------------------------------------------------------------

    def transcribe(self, audio: bytes, language: str | None = None) -> dict[str, Any]:
        if self._state == "loading":
            raise ModelLoading
        if self._state != "ready":
            raise ModelUnavailable(self._reason or "The speech model is not available.")
        # Decoded (and bounded) before the model is touched, and outside its lock: a refused upload never waits for,
        # or delays, a transcription.
        samples = decode_bounded(audio, self._max_audio_seconds)
        with self._lock:
            try:
                segments_iter, info = self._model.transcribe(
                    samples,
                    task="transcribe",  # never "translate"
                    language=language,
                    beam_size=5,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 500},
                    condition_on_previous_text=False,
                    word_timestamps=False,
                )
                raw = list(segments_iter)
            except ValueError as e:
                if "language" in str(e).lower():
                    raise InvalidLanguage from e
                raise UndecodableAudio from e
            except Exception as e:  # noqa: BLE001 - decoder errors differ by container; never echo their text
                if type(e).__module__.startswith("av"):
                    raise UndecodableAudio from e
                raise
        segments = []
        for s in raw:
            text = (s.text or "").strip()
            if not text:
                continue
            avg = float(s.avg_logprob)
            segments.append(
                {
                    "startMs": round(float(s.start) * 1000),
                    "endMs": round(float(s.end) * 1000),
                    "text": text,
                    "avgLogprob": round(avg, 4),
                    "noSpeechProb": round(float(s.no_speech_prob), 4),
                    "confidence": round(min(1.0, max(0.0, math.exp(avg))), 3),
                }
            )
        segments.sort(key=lambda x: (x["startMs"], x["endMs"]))
        return {
            "model": self.info().as_dict(),
            "language": info.language,
            "languageProbability": round(float(info.language_probability), 4),
            "languageSource": "hint" if language else "detected",
            "durationMs": round(float(info.duration) * 1000),
            "confidenceKind": CONFIDENCE_KIND,
            "speakers": "not_identified",
            "segments": segments,
        }
