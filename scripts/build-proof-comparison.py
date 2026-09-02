#!/usr/bin/env python3
"""Build a synchronized original-versus-reconstruction review artifact."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FONT = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("original", type=Path)
    parser.add_argument("result", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--duration", type=float, default=5.116)
    return parser.parse_args()


def draw_centered(draw: ImageDraw.ImageDraw, text: str, center_x: int) -> None:
    font = ImageFont.truetype(str(FONT), 24)
    bounds = draw.textbbox((0, 0), text, font=font)
    x = center_x - (bounds[2] - bounds[0]) // 2
    draw.text((x, 14), text, font=font, fill="white")


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    labels = args.output_dir / "comparison-labels.png"
    video = args.output_dir / "original-vs-seedance.mp4"
    sheet = args.output_dir / "original-vs-seedance-contact-sheet.jpg"

    header = Image.new("RGBA", (960, 56), (10, 10, 10, 255))
    draw = ImageDraw.Draw(header)
    draw_centered(draw, "ORIGINAL", 240)
    draw_centered(draw, "SEEDANCE RESULT", 720)
    header.save(labels)

    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(args.original), "-i", str(args.result),
            "-loop", "1", "-i", str(labels),
            "-filter_complex",
            "[0:v]scale=480:854:flags=lanczos,setsar=1[left];"
            "[1:v]scale=480:854:flags=lanczos,setsar=1[right];"
            "[left][right]hstack=inputs=2,pad=960:910:0:56:black[body];"
            "[body][2:v]overlay=0:0:shortest=1[v]",
            "-map", "[v]", "-map", "0:a:0",
            "-t", str(args.duration),
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            str(video),
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(video),
            "-vf", "fps=1,scale=480:455:flags=lanczos,tile=3x2:padding=4:margin=4",
            "-frames:v", "1", str(sheet),
        ],
        check=True,
    )
    print(video)
    print(sheet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
