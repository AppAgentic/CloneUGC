#!/usr/bin/env python3
"""Rebuild the selected compiler hand-wipe result without another paid generation."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output/max-turbo-7672577678309870861/source.mp4"
BEFORE = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/run-v2/unit-before/slot-B/candidate-B.mp4"
AFTER = ROOT / "output/format-instantiations/hand-wipe-blonde-r3ta-pepmod-v1-run/raw/shot-02.mp4"
OVERLAY = ROOT / "output/max-turbo-7672577678309870861/caption-overlay-gymlevels.png"
OUTPUT = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/candidate-B-v2-accepted-after-repair.mp4"
COMPARISON = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/comparison-original-left-candidate-B-v2-accepted-after-repair-right.mp4"
MANIFEST = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/candidate-B-v2-accepted-after-repair.json"


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # Cut the selected compiler before-take while the palm completely fills the frame.
    # Remove the accepted after-take's brief recording-device adjustment while the
    # transition is still visually occluded. Both sections remain within 10% of real time.
    filters = (
        "[0:v]crop=756:1344:6:0,scale=720:1280,fps=60,"
        "trim=duration=4.550,setpts=(PTS-STARTPTS)*1.053[v0];"
        "[1:v]crop=756:1344:6:0,scale=720:1280,fps=60,split=2[a][b];"
        "[a]trim=start=0:end=0.500,setpts=PTS-STARTPTS[a0];"
        "[b]trim=start=0.900,setpts=PTS-STARTPTS[b0];"
        "[a0][b0]concat=n=2:v=1:a=0,setpts=PTS*1.096,"
        "trim=duration=5.241,setpts=PTS-STARTPTS[v1];"
        "[v0][v1]concat=n=2:v=1:a=0[base];"
        "[2:v]format=rgba[caption];"
        "[base][caption]overlay=0:0:enable='lt(t,4.69)',format=yuv420p[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(BEFORE), "-i", str(AFTER),
        "-loop", "1", "-i", str(OVERLAY), "-i", str(SOURCE), "-filter_complex", filters,
        "-map", "[video]", "-map", "3:a:0", "-t", "10.031", "-r", "60",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", str(OUTPUT),
    ])
    compare = (
        "[0:v]scale=720:1280,fps=60[left];[1:v]scale=720:1280,fps=60[right];"
        "[left][right]hstack=inputs=2,format=yuv420p[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(SOURCE), "-i", str(OUTPUT),
        "-filter_complex", compare, "-map", "[video]", "-map", "0:a:0", "-t", "10.031",
        "-r", "60", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(COMPARISON),
    ])
    manifest = {
        "schemaVersion": "0.1.0",
        "selectedLane": "compiler",
        "paidGenerationCalls": 0,
        "before": {"path": str(BEFORE), "sha256": sha256(BEFORE), "reuse": "selected compiler v2 take"},
        "after": {"path": str(AFTER), "sha256": sha256(AFTER), "reuse": "previously operator-accepted take"},
        "timing": {
            "beforeMs": 4790,
            "beforeRetimeFactor": 1.053,
            "afterMs": 5241,
            "afterRetimeFactor": 1.096,
            "removedAfterIntervalMs": [500, 900],
        },
        "output": {"path": str(OUTPUT), "sha256": sha256(OUTPUT)},
        "comparison": {"path": str(COMPARISON), "sha256": sha256(COMPARISON)},
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
