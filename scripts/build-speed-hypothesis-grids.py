#!/usr/bin/env python3
"""Build simultaneous 2x3 grids of alternate timeline corrections for each case."""

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


def render_grid(source: Path, target: Path, duration: float) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    filters: list[str] = []
    labels: list[str] = []
    for index, correction in enumerate(CORRECTIONS):
        label = f"v{index}"
        filters.append(
            f"[0:v]setpts={correction}*PTS,fps=30,"
            "scale=240:426:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,"
            "pad=240:426:(ow-iw)/2:(oh-ih)/2:black,"
            f"tpad=stop_mode=clone:stop_duration={duration},"
            f"trim=duration={duration},setpts=PTS-STARTPTS[{label}]"
        )
        labels.append(f"[{label}]")
    filters.append(f"color=c=black:s=240x426:r=30:d={duration}[blank]")
    filters.append(
        f"{''.join(labels)}[blank]xstack=inputs=6:"
        "layout=0_0|240_0|480_0|0_426|240_426|480_426[out]"
    )
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
    parser.add_argument("--duration", type=float, default=10.0)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    cases: list[dict[str, object]] = []
    for case in manifest["cases"]:
        target = args.output_dir / f"{case['id']}.mp4"
        render_grid(Path(case["media"]["path"]), target, args.duration)
        cases.append({"id": case["id"], "path": str(target), "corrections": CORRECTIONS})
        print(target, flush=True)
    (args.output_dir / "manifest.json").write_text(json.dumps({"cases": cases}, indent=2) + "\n")


if __name__ == "__main__":
    main()
