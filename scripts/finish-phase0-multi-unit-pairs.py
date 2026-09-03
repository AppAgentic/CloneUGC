#!/usr/bin/env python3
"""Deterministically assemble the two Phase 0 multi-unit blind A/B pairs."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


WIDTH = 720
HEIGHT = 1280
FPS = 30
FAMILY_UNIT_IDS = [
    "unit-adult-frontal",
    "unit-adult-profile",
    "unit-stacked-arms",
    "unit-fan-arms-one",
    "unit-group-reset",
    "unit-seated-flex",
    "unit-fan-arms-two",
    "unit-seated-fan",
    "unit-vertical-stack",
    "unit-dumbbell-cluster",
    "unit-low-symmetry",
    "unit-hoodie-final",
]
FAMILY_FRAME_COUNTS = [52, 15, 18, 29, 36, 14, 15, 19, 21, 15, 18, 14, 18, 17, 31, 14, 42]


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames",
            "-of", "json", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def finish_hand_wipe(root: Path, source: Path, overlay: Path, slot: str, run_name: str, suffix: str) -> Path:
    before = root / run_name / "unit-before" / f"slot-{slot}" / f"candidate-{slot}.mp4"
    after = root / run_name / "unit-after" / f"slot-{slot}" / f"candidate-{slot}.mp4"
    output = root / f"candidate-{slot}{suffix}.mp4"
    # Scale each complete provider take onto the source's exact 144/161-frame split.
    filters = (
        "[0:v]crop=756:1344:6:0,scale=720:1280,setpts=PTS*0.9270968,fps=30,"
        "trim=end_frame=144,setpts=PTS-STARTPTS[v0];"
        "[1:v]crop=756:1344:6:0,scale=720:1280,setpts=PTS*0.5176296,fps=30,"
        "trim=end_frame=161,setpts=PTS-STARTPTS[v1];"
        "[v0][v1]concat=n=2:v=1:a=0[base];"
        "[2:v]format=rgba[caption];"
        "[base][caption]overlay=0:0:enable='lt(t,4.69)',format=yuv420p[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y",
        "-i", str(before), "-i", str(after), "-loop", "1", "-i", str(overlay), "-i", str(source),
        "-filter_complex", filters, "-map", "[video]", "-map", "3:a:0", "-frames:v", "305",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", str(output),
    ])
    return output


def finish_family(root: Path, source: Path, crops: Path, slot: str, run_name: str, suffix: str) -> Path:
    output = root / f"candidate-{slot}{suffix}.mp4"
    video_only = root / f"candidate-{slot}{suffix}-video-only.mp4"
    command = ["ffmpeg", "-loglevel", "error", "-y"]
    for index in range(1, 6):
        command += ["-loop", "1", "-framerate", str(FPS), "-i", str(crops / f"photo-{index:02d}.png")]
    for unit_id in FAMILY_UNIT_IDS:
        command += ["-i", str(root / run_name / unit_id / f"slot-{slot}" / f"candidate-{slot}.mp4")]
    filters = []
    for index, frames in enumerate(FAMILY_FRAME_COUNTS):
        filters.append(
            f"[{index}:v]fps={FPS},scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},trim=end_frame={frames},setpts=PTS-STARTPTS,format=yuv420p[v{index}]"
        )
    filters.append("".join(f"[v{i}]" for i in range(17)) + "concat=n=17:v=1:a=0[video]")
    command += [
        "-filter_complex", ";".join(filters), "-map", "[video]", "-frames:v", "388", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(video_only),
    ]
    run(command)
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(video_only), "-i", str(source),
        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", str(output),
    ])
    return output


def comparison(source: Path, candidate: Path, output: Path, frames: int) -> None:
    video_only = output.with_name(output.stem + "-video-only.mp4")
    filters = (
        f"[0:v]fps={FPS},scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:black[left];"
        f"[1:v]fps={FPS},scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:black[right];"
        "[left][right]hstack=inputs=2[video]"
    )
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(source), "-i", str(candidate),
        "-filter_complex", filters, "-map", "[video]", "-frames:v", str(frames), "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(video_only),
    ])
    run([
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(video_only), "-i", str(source),
        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-movflags", "+faststart", str(output),
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--run-name", default="run")
    parser.add_argument("--suffix", default="")
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    hand_root = workspace / "tmp/phase0e-2026-09-03/hand-wipe"
    family_root = workspace / "tmp/phase0e-2026-09-03/family"
    hand_source = workspace / "output/max-turbo-7672577678309870861/source.mp4"
    hand_overlay = workspace / "output/max-turbo-7672577678309870861/caption-overlay-gymlevels.png"
    family_source = workspace / "output/source-analysis/instagram-DcyIWPYtZkV/source.mp4"
    family_crops = workspace / "output/source-analysis/instagram-DcyIWPYtZkV/run-v1/photo-crops"
    outputs: dict[str, dict[str, dict]] = {"handWipe": {}, "family": {}}
    for slot in ("A", "B"):
        hand = finish_hand_wipe(hand_root, hand_source, hand_overlay, slot, args.run_name, args.suffix)
        hand_comparison = hand_root / f"comparison-original-left-candidate-{slot}{args.suffix}-right.mp4"
        comparison(hand_source, hand, hand_comparison, 305)
        family = finish_family(family_root, family_source, family_crops, slot, args.run_name, args.suffix)
        family_comparison = family_root / f"comparison-original-left-candidate-{slot}{args.suffix}-right.mp4"
        comparison(family_source, family, family_comparison, 388)
        outputs["handWipe"][slot] = {
            "candidate": {"path": str(hand), "sha256": sha256(hand), "probe": probe(hand)},
            "comparison": {"path": str(hand_comparison), "sha256": sha256(hand_comparison), "probe": probe(hand_comparison)},
        }
        outputs["family"][slot] = {
            "candidate": {"path": str(family), "sha256": sha256(family), "probe": probe(family)},
            "comparison": {"path": str(family_comparison), "sha256": sha256(family_comparison), "probe": probe(family_comparison)},
        }
    manifest = {
        "schemaVersion": "0.1.0",
        "blindMappingStillSealed": True,
        "deterministicFinishing": [
            "source-exact frame counts", "source cut boundaries", "identical overlays", "source AAC stream copy",
        ],
        "outputs": outputs,
    }
    manifest_path = workspace / f"tmp/phase0e-2026-09-03/finished-manifest{args.suffix}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
