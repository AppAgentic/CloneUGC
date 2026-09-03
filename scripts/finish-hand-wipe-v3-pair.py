#!/usr/bin/env python3
"""Finish the corrected two-take hand-wipe blind pair identically per lane."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAIR = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/run-v3"
SOURCE = ROOT / "output/max-turbo-7672577678309870861/source.mp4"
OVERLAY = ROOT / "output/max-turbo-7672577678309870861/caption-overlay-gymlevels.png"
OUTPUT_ROOT = ROOT / "tmp/phase0e-2026-09-03/hand-wipe"


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finish(slot: str) -> tuple[Path, Path]:
    before = PAIR / "unit-before" / f"slot-{slot}" / f"candidate-{slot}.mp4"
    after = PAIR / "unit-after" / f"slot-{slot}" / f"candidate-{slot}.mp4"
    output = OUTPUT_ROOT / f"candidate-{slot}-v3.mp4"
    comparison = OUTPUT_ROOT / f"comparison-original-left-candidate-{slot}-v3-right.mp4"
    filters = (
        "[0:v]crop=756:1344:6:0,scale=720:1280,setpts=PTS*0.958,fps=60[v0];"
        "[1:v]crop=756:1344:6:0,scale=720:1280,setpts=PTS*1.011,fps=60[v1];"
        "[v0][v1]concat=n=2:v=1:a=0,trim=duration=10.031,setpts=PTS-STARTPTS[base];"
        "[2:v]format=rgba[caption];"
        "[base][caption]overlay=0:0:enable='lt(t,4.69)',format=yuv420p[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(before), "-i", str(after),
        "-loop", "1", "-i", str(OVERLAY), "-i", str(SOURCE), "-filter_complex", filters,
        "-map", "[video]", "-map", "3:a:0", "-t", "10.031", "-r", "60",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", str(output),
    ])
    compare_filters = (
        "[0:v]scale=720:1280,fps=60[left];[1:v]scale=720:1280,fps=60[right];"
        "[left][right]hstack=inputs=2,format=yuv420p[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(SOURCE), "-i", str(output),
        "-filter_complex", compare_filters, "-map", "[video]", "-map", "0:a:0",
        "-t", "10.031", "-r", "60", "-c:v", "libx264", "-preset", "medium",
        "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy",
        "-movflags", "+faststart", str(comparison),
    ])
    return output, comparison


def main() -> None:
    outputs = {}
    for slot in ("A", "B"):
        output, comparison = finish(slot)
        outputs[slot] = {
            "outputPath": str(output),
            "outputSha256": sha256(output),
            "comparisonPath": str(comparison),
            "comparisonSha256": sha256(comparison),
        }
    manifest = {
        "schemaVersion": "0.1.0",
        "sealedPlanSha256": json.loads((PAIR / "sealed-mapping.json").read_text())["sealedPlanSha256"],
        "blindMappingStillSealed": True,
        "paidGenerationCalls": 4,
        "finishing": {
            "beforeTargetMs": 4790,
            "afterTargetMs": 5241,
            "beforeRetimeFactor": 0.958,
            "afterRetimeFactor": 1.011,
            "captionEndMs": 4690,
            "sourceAudioCopied": True,
        },
        "outputs": outputs,
    }
    manifest_path = OUTPUT_ROOT / "finished-manifest-v3.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
