#!/usr/bin/env python3
"""Apply the approved CloneUGC overlay and source audio to a generated proof."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
HEADER = "Getting lean is EASY."
BODY = [
    "Fast till noon.",
    "Last meal at 8.",
    "Whole foods only.",
    "Water only.",
    "10-12k steps.",
    "Gym 4 times a week.",
    "7-9 hrs sleep.",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("generated", type=Path)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--duration", type=float, default=5.116)
    parser.add_argument("--captions-from-generation", action="store_true")
    return parser.parse_args()


def centered_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    y: int,
    font: ImageFont.FreeTypeFont,
    width: int,
) -> None:
    bounds = draw.textbbox((0, 0), text, font=font, stroke_width=3)
    x = (width - (bounds[2] - bounds[0])) // 2
    draw.text(
        (x, y),
        text,
        font=font,
        fill="white",
        stroke_width=3,
        stroke_fill="black",
    )


def main() -> int:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    inputs = ["-i", str(args.generated)]
    if args.captions_from_generation:
        filter_complex = f"[0:v]trim=duration={args.duration},setpts=PTS-STARTPTS[v]"
        audio_input = "1:a:0"
    else:
        overlay_path = args.output.with_name("overlay.png")
        overlay = Image.new("RGBA", (480, 854), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        font = ImageFont.truetype(str(FONT), 26)
        centered_text(draw, HEADER, 454, font, overlay.width)
        for index, line in enumerate(BODY):
            centered_text(draw, line, 535 + index * 35, font, overlay.width)
        overlay.save(overlay_path)
        inputs.extend(["-loop", "1", "-i", str(overlay_path)])
        filter_complex = (
            f"[0:v]trim=duration={args.duration},setpts=PTS-STARTPTS[base];"
            "[base][1:v]overlay=0:0:shortest=1[v]"
        )
        audio_input = "2:a:0"
    inputs.extend(["-i", str(args.source)])

    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            *inputs,
            "-filter_complex", filter_complex,
            "-map", "[v]", "-map", audio_input,
            "-t", str(args.duration),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(args.output),
        ],
        check=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
