#!/usr/bin/env python3
"""Finish a compiler-only hand-wipe retest and compare it with accepted control B."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/run-v4"
SOURCE = ROOT / "output/max-turbo-7672577678309870861/source.mp4"
OVERLAY = ROOT / "output/max-turbo-7672577678309870861/caption-overlay-gymlevels.png"
ACCEPTED_CONTROL = ROOT / "tmp/phase0e-2026-09-03/hand-wipe/candidate-B-v3.mp4"
OUTPUT_ROOT = ROOT / "tmp/phase0e-2026-09-03/hand-wipe"


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    before = RUN / "unit-before/slot-compiler-retest/candidate-compiler-retest.mp4"
    after = RUN / "unit-after/slot-compiler-retest/candidate-compiler-retest.mp4"
    output = OUTPUT_ROOT / "candidate-compiler-v4.mp4"
    comparison = OUTPUT_ROOT / "comparison-original-control-B-compiler-v4.mp4"
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
        "[0:v]scale=720:1280,fps=60[left];"
        "[1:v]scale=720:1280,fps=60[mid];"
        "[2:v]scale=720:1280,fps=60[right];"
        "[left][mid][right]hstack=inputs=3,format=yuv420p[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(SOURCE), "-i", str(ACCEPTED_CONTROL),
        "-i", str(output), "-filter_complex", compare_filters, "-map", "[video]", "-map", "0:a:0",
        "-t", "10.031", "-r", "60", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(comparison),
    ])
    plan = json.loads((RUN / "sealed-plan.json").read_text())
    receipts = [
        json.loads((RUN / unit / "slot-compiler-retest/receipt.json").read_text())
        for unit in ("unit-before", "unit-after")
    ]
    manifest = {
        "schemaVersion": "0.1.0",
        "sealedPlanSha256": plan["sealedPlanSha256"],
        "priorPairSealedPlanSha256": plan["priorPairSealedPlanSha256"],
        "reusedAcceptedControlSha256": sha256(ACCEPTED_CONTROL),
        "paidGenerationCalls": 2,
        "providerRequestIds": [receipt["providerRequestId"] for receipt in receipts],
        "automaticPaidRetries": 0,
        "finishing": {
            "beforeTargetMs": 4790,
            "afterTargetMs": 5241,
            "beforeRetimeFactor": 0.958,
            "afterRetimeFactor": 1.011,
            "captionEndMs": 4690,
            "sourceAudioCopied": True,
        },
        "outputPath": str(output),
        "outputSha256": sha256(output),
        "comparisonPath": str(comparison),
        "comparisonSha256": sha256(comparison),
    }
    manifest_path = OUTPUT_ROOT / "finished-manifest-v4.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
