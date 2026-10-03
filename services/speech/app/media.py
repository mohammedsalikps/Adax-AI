"""What an upload is, and how much of it will be decoded.

The service receives bytes from a caller it does not trust (a browser upload relayed by the API, or anything else on this
computer). Before any decoder sees them:

* **The content decides, not the file name or type.** The first bytes must be one of the audio containers the application
  accepts (WebM, Ogg, WAV, MP3, MP4/M4A). Anything else (a text file, a playlist, an image, a script) is refused as
  unsupported media.
* **The demuxer is chosen by us, not by the bytes.** FFmpeg can otherwise pick any of its many demuxers from the content,
  including ones that read further inputs by name (playlists, concatenation lists). The container is opened with the one
  demuxer for the sniffed kind, with a protocol whitelist that allows nothing but in-memory data, so an upload cannot make
  the service open a file or a network address.
* **A length bound before the expensive work.** A duration the container declares is checked first; a container that
  declares none (a streamed WebM) is decoded in a stream that stops, and refuses, the moment more than the allowed number of
  seconds has come out. The audio is never decoded to the end first and measured afterwards.

Nothing is written to disk.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np

SAMPLE_RATE = 16000


class UndecodableAudio(Exception):
    """The bytes are not audio the decoder can read."""


class UnsupportedMedia(Exception):
    """The bytes are not one of the audio containers the service reads."""


class AudioTooLong(Exception):
    """The audio is longer than the service will decode."""


#: Options every container is opened with: the only protocol FFmpeg may use for anything the container refers to is in-memory
#: data, so no file, address or device named inside an upload can be opened.
DEMUX_OPTIONS = {"protocol_whitelist": "data"}

#: sniffed kind -> FFmpeg demuxer name
DEMUXERS = {
    "webm": "matroska,webm",
    "ogg": "ogg",
    "wav": "wav",
    "mp3": "mp3",
    "mp4": "mov,mp4,m4a,3gp,3g2,mj2",
}


def sniff(data: bytes) -> str | None:
    """The container kind from the first bytes, or None if it is not one the service reads."""
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if data[:4] == b"OggS":
        return "ogg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "mp3"
    if len(data) >= 8 and data[4:8] == b"ftyp":
        return "mp4"
    return None


def declared_seconds(container: Any) -> float | None:
    """The duration the container itself declares, if it does (WebM from a streaming recorder often does not)."""
    d = getattr(container, "duration", None)
    if d is None or d <= 0:
        return None
    return float(d) / 1_000_000  # av.time_base: microseconds


def decode_bounded(data: bytes, max_seconds: float) -> np.ndarray:
    """Mono 16 kHz float32 samples in [-1, 1), or an exception. Never decodes more than `max_seconds` of audio."""
    kind = sniff(data)
    if kind is None:
        raise UnsupportedMedia
    import av  # noqa: PLC0415 - imported when first needed

    limit = int(max_seconds * SAMPLE_RATE)
    try:
        container = av.open(
            io.BytesIO(data),
            mode="r",
            format=DEMUXERS[kind],
            options=dict(DEMUX_OPTIONS),
        )
    except Exception as e:  # noqa: BLE001 - decoder errors differ by container; never echo their text
        raise UndecodableAudio from e
    try:
        declared = declared_seconds(container)
        if declared is not None and declared > max_seconds:
            raise AudioTooLong
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise UndecodableAudio
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        chunks: list[np.ndarray] = []
        total = 0

        def take(frames: list[Any]) -> None:
            nonlocal total
            for f in frames:
                arr = f.to_ndarray().reshape(-1)
                chunks.append(arr)
                total += arr.shape[0]
                if total > limit:
                    raise AudioTooLong

        try:
            for frame in container.decode(stream):
                take(resampler.resample(frame))
            take(resampler.resample(None))
        except (AudioTooLong, UndecodableAudio):
            raise
        except Exception as e:  # noqa: BLE001
            raise UndecodableAudio from e
    finally:
        container.close()
    if not chunks:
        raise UndecodableAudio
    return np.concatenate(chunks).astype(np.float32) / 32768.0
