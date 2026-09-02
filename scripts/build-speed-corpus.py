#!/usr/bin/env python3
"""Build deterministic playback-rate variants from permission-safe source clips."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

SPEEDS = (0.5, 1.0, 1.5, 2.0, 3.0)


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(command)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def duration_ms(path: Path) -> int:
    seconds = float(run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]))
    return round(seconds * 1000)


def render_constant(source: Path, target: Path, multiplier: float) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-map", "0:v:0", "-an", "-vf", f"setpts=PTS/{multiplier},fps=30",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(target),
    ])


def render_inspection(source: Path, target: Path, factor: float) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-map", "0:v:0", "-an", "-vf", f"setpts={factor}*PTS,fps=30",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(target),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", action="append", required=True, metavar="FAMILY=PATH")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--inspection-max-ms", type=int, default=30000)
    args = parser.parse_args()

    cases: list[dict[str, object]] = []
    for source_arg in args.source:
        family, separator, raw_path = source_arg.partition("=")
        if not separator or not family or not raw_path:
            raise SystemExit(f"invalid --source {source_arg!r}; expected FAMILY=PATH")
        source = Path(raw_path).expanduser().resolve()
        if not source.is_file():
            raise SystemExit(f"source does not exist: {source}")
        for multiplier in SPEEDS:
            label = str(multiplier).replace(".", "p")
            case_id = f"{family}-{label}x"
            media = args.output_dir / "media" / f"{case_id}.mp4"
            render_constant(source, media, multiplier)
            delivered_ms = duration_ms(media)
            inspection_factor = min(4.0, args.inspection_max_ms / delivered_ms)
            inspection = args.output_dir / "inspection" / f"{case_id}-{inspection_factor:.2f}x.mp4"
            render_inspection(media, inspection, inspection_factor)
            expected_class = "real_time" if multiplier == 1 else ("sped_up" if multiplier > 1 else "slowed_down")
            cases.append({
                "id": case_id,
                "family": family,
                "transform": "constant",
                "expectedClass": expected_class,
                "expectedMultiplier": multiplier,
                "source": {"path": str(source), "sha256": sha256(source)},
                "media": {"path": str(media), "sha256": sha256(media), "durationMs": delivered_ms},
                "inspection": {
                    "path": str(inspection), "sha256": sha256(inspection),
                    "durationMs": duration_ms(inspection), "timeExpansionFactor": inspection_factor,
                },
            })

    manifest = {
        "schemaVersion": "0.1.0",
        "construction": "deterministic-constant-speed-silent",
        "cases": cases,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
