#!/usr/bin/env python3
"""Build a fixed-duration reel of alternate timeline corrections for each speed case."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

CORRECTIONS = (0.5, 1.0, 1.5, 2.0, 3.0)


def run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(command)}\n{result.stderr.strip()}")


def render_reel(source: Path, target: Path, seconds_per_candidate: float) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    filters: list[str] = []
    labels: list[str] = []
    for index, correction in enumerate(CORRECTIONS):
        label = f"v{index}"
        filters.append(
            f"[0:v]setpts={correction}*PTS,fps=30,"
            f"scale=480:854:force_original_aspect_ratio=decrease,"
            f"pad=480:854:(ow-iw)/2:(oh-ih)/2:black,"
            f"trim=duration={seconds_per_candidate},"
            f"tpad=stop_mode=clone:stop_duration={seconds_per_candidate},"
            f"trim=duration={seconds_per_candidate},setpts=PTS-STARTPTS[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(f"{''.join(labels)}concat=n={len(labels)}:v=1:a=0[out]")
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-filter_complex", ";".join(filters), "-map", "[out]", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(target),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--seconds-per-candidate", type=float, default=4.0)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    cases: list[dict[str, object]] = []
    for case in manifest["cases"]:
        target = args.output_dir / f"{case['id']}.mp4"
        render_reel(Path(case["media"]["path"]), target, args.seconds_per_candidate)
        cases.append({
            "id": case["id"], "path": str(target), "corrections": CORRECTIONS,
            "secondsPerCandidate": args.seconds_per_candidate,
        })
        print(target, flush=True)
    (args.output_dir / "manifest.json").write_text(json.dumps({"cases": cases}, indent=2) + "\n")


if __name__ == "__main__":
    main()
