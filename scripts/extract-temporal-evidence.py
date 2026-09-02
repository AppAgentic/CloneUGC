#!/usr/bin/env python3
"""Extract content-agnostic retiming evidence without making a speed classification."""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import subprocess
from pathlib import Path


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(command)}\n{result.stderr.strip()}")
    return result


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    args = parser.parse_args()
    video = args.video.resolve()

    probe = json.loads(run([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=avg_frame_rate,nb_frames,width,height:format=duration", "-of", "json", str(video),
    ]).stdout)
    stream = probe["streams"][0]
    numerator, denominator = map(float, stream["avg_frame_rate"].split("/"))
    fps = numerator / denominator

    difference = run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video), "-an", "-vf",
        "tblend=all_mode=difference,signalstats,metadata=print:file=-", "-f", "null", "-",
    ]).stdout
    y_differences = [float(value) for value in re.findall(r"lavfi\.signalstats\.YAVG=([0-9.]+)", difference)]
    if not y_differences:
        raise RuntimeError("no frame-difference evidence was produced")
    near_duplicate_indexes = [index for index, value in enumerate(y_differences) if value < 0.5]
    gaps = [right - left for left, right in zip(near_duplicate_indexes, near_duplicate_indexes[1:])]

    blur_log = run([
        "ffmpeg", "-hide_banner", "-loglevel", "info", "-i", str(video),
        "-an", "-vf", "blurdetect", "-f", "null", "-",
    ]).stderr
    blur_matches = re.findall(r"blur mean:\s*([0-9.]+)", blur_log)
    blur_mean = float(blur_matches[-1]) if blur_matches else None
    mean_difference = statistics.fmean(y_differences)
    evidence = {
        "path": str(video),
        "durationMs": round(float(probe["format"]["duration"]) * 1000),
        "width": stream["width"],
        "height": stream["height"],
        "fps": fps,
        "frameCount": int(stream.get("nb_frames") or round(float(probe["format"]["duration"]) * fps)),
        "frameDifferenceY": {
            "mean": mean_difference,
            "p10": percentile(y_differences, 0.10),
            "p50": percentile(y_differences, 0.50),
            "p90": percentile(y_differences, 0.90),
            "fractionBelow0p5": sum(value < 0.5 for value in y_differences) / len(y_differences),
            "fractionBelow1p0": sum(value < 1.0 for value in y_differences) / len(y_differences),
        },
        "nearDuplicateCadence": {
            "count": len(near_duplicate_indexes),
            "medianGapFrames": statistics.median(gaps) if gaps else None,
            "gapCoefficientOfVariation": (
                statistics.pstdev(gaps) / statistics.fmean(gaps) if len(gaps) > 1 and statistics.fmean(gaps) else None
            ),
        },
        "blurMean": blur_mean,
        "meanDifferenceToBlurRatio": mean_difference / blur_mean if blur_mean else None,
        "interpretationBoundary": (
            "These are structural observations, not a speed verdict. Near-duplicate cadence can support "
            "slowdown/frame interpolation; high displacement relative to captured blur can support post-capture "
            "acceleration. Low-motion content, stabilization, frame-rate conversion, and encoding can mimic either."
        ),
    }
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
