"""Download the speech model once, verify it, and write it where the service reads it.

    python -m app.fetch_model --dest ../../.data/models/faster-whisper-small

This is the ONLY place in the service that uses the network, and it is run by a
person (npm run speech:model), never by the service. The files, source and
size are pinned in models.lock.json; every file's SHA-256 is checked and a
mismatch deletes the download.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# This command is the one place that goes online (the engine switches the hub off at import).
os.environ["HF_HUB_OFFLINE"] = "0"

from app.engine import sha256_file  # noqa: E402

LOCK = Path(__file__).resolve().parent.parent / "models.lock.json"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dest", required=True)
    p.add_argument("--yes", action="store_true", help="download without asking")
    args = p.parse_args(argv)
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    total = sum(f["bytes"] for f in lock["files"])
    print(f"Model: {lock['repo']} @ {lock['revision']} ({lock['license']})")
    for f in lock["files"]:
        print(f"  {f['name']:<16} {f['bytes']:>12,} bytes")
    print(f"  total            {total:>12,} bytes -> {args.dest}")
    if not args.yes and input("Download? [y/N] ").strip().lower() != "y":
        print("Not downloaded.")
        return 1
    from huggingface_hub import hf_hub_download

    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    for f in lock["files"]:
        target = dest / f["name"]
        if target.is_file() and target.stat().st_size == f["bytes"] and f["sha256"] and sha256_file(target) == f["sha256"]:
            print(f"  {f['name']}: already present and verified")
            continue
        got = Path(
            hf_hub_download(
                repo_id=lock["repo"], filename=f["name"], revision=lock["revision"], local_dir=str(dest), local_files_only=False
            )
        )
        digest = sha256_file(got)
        if got.stat().st_size != f["bytes"] or (f["sha256"] and digest != f["sha256"]):
            got.unlink(missing_ok=True)
            print(f"  {f['name']}: size or SHA-256 MISMATCH, deleted", file=sys.stderr)
            return 2
        # Small files have no published SHA-256: the revision is pinned; record the printed hash in the lock file.
        print(
            f"  {f['name']}: downloaded; sha256 {digest}"
            + ("  (verified)" if f["sha256"] else "  (record this in models.lock.json)")
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
