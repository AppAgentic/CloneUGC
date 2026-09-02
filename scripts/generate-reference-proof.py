#!/usr/bin/env python3
"""Submit one bounded Seedance reference-video proof with an auditable job receipt."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any


REFERENCE_MODEL = "bytedance/seedance-2.5/reference-to-video"
TEXT_MODEL = "bytedance/seedance-2.5/text-to-video"
PRICE_PER_1K_TOKENS = 0.0214
VIDEO_REFERENCE_MULTIPLIER = 0.6
TEXT_480P_COST_PER_SECOND = 0.2205
DIMENSIONS = {"480p": (496, 864), "720p": (720, 1280)}
REFERENCE_PROMPT = """Use @Video1 as the sole rights-cleared base reference. Reconstruct the same vertical gym moment as faithfully as possible: the same approved adult lifter identity and physique, black shirt, light sweatpants, headphones, incline bench, two 105-pound dumbbells, low wide phone-camera framing, commercial gym layout, lighting, natural bystander paths, and real-time incline-press motion. Preserve one continuous take with no cuts, transitions, speed ramps, slow motion, time lapse, freeze, reverse, camera move, or invented action. Match the source motion timing through the first 5.116 seconds; any remaining generated tail should simply hold the ending action naturally. Do not add a checklist, subtitles, captions, watermark, or new text—the approved overlay and source audio will be restored deterministically after generation. No beautification, cinematic relighting, stylization, face morphing, anatomy distortion, extra people, extra equipment, or changed wardrobe."""
TEXT_PROMPT = """FORMAT
6-second vertical 9:16 raw social-media phone video, one continuous take, natural real-time speed. It must feel like an ordinary handheld gym recording, not an advertisement or cinematic production.

STARTING STATE
A very muscular young adult man with light-to-medium skin, thick short curly dark-brown hair, clean-shaven face, and black over-ear headphones lies back on a bright royal-blue incline bench. He wears an oversized washed charcoal-black T-shirt, loose pale-grey sweatpants, and dark training shoes. He grips exactly two enormous matching black round 105-pound dumbbells, one in each hand, palms facing forward, elbows bent beside his upper chest. His feet are planted wide near the bottom corners of frame.

The commercial strength gym has a dark speckled rubber floor, dense silver-and-black weight machines, an orange-and-black rear wall, and a black metal staircase rising diagonally from lower right to upper left toward a mezzanine. Large white letters reading HIT and a white script-style Zone shape sit high on the rear wall, but keep background signage soft and incidental rather than generated foreground text. A stocky middle-aged male gym-goer in a navy shirt, grey shorts, white socks, dark shoes, and a backwards grey cap stands several metres behind the bench and casually shifts position; other distant gym users move naturally without interacting.

TIMELINE AND PHYSICS
0.0-1.6 seconds: beginning from the lower incline-press position, the lifter drives both dumbbells upward together. His forearms become vertical, elbows extend, shoulders stay pinned to the bench, wrists remain stacked under the weights, and the two dumbbells travel on symmetrical slightly inward arcs. His face shows controlled strain.
1.6-2.2 seconds: both dumbbells reach the top above the upper chest without touching. Arms are almost straight but not hyperextended. He stabilizes the heavy weights briefly; the plates wobble only a little from believable effort.
2.2-3.8 seconds: he lowers both dumbbells slowly and evenly under control. Elbows bend outward, upper arms descend beside the chest, and the weights preserve mass, inertia, gravity, and identical geometry. The bench, his torso, feet, clothing, and headphones do not shift or reset.
3.8-5.4 seconds: he presses both dumbbells upward for the next repetition, following the same symmetrical path. His chest and triceps visibly engage, his face tightens slightly, and he exhales while the weights rise.
5.4-6.0 seconds: he reaches the top position again and holds the same two dumbbells steady while the natural body effort settles. No new action begins.

CAMERA AND IMAGE CHARACTER
The phone camera is fixed very low at the foot and slightly left of the incline bench, about knee height, tilted upward with a mildly wide phone lens. The lifter fills the lower two-thirds; shoes and knees are closest to camera, torso recedes toward centre, dumbbells frame his head and shoulders, and the staircase and mezzanine remain visible behind him. Keep the original-looking deep focus and fixed composition for the entire clip. Only tiny authentic hand-held micro-jitter, exposure breathing, phone sharpening, mild high-ISO grain, and social-video compression are allowed. Bright flat overhead gym lighting, neutral phone white balance, realistic skin texture, no beauty filter, no shallow depth of field, no dramatic relighting.

CONTINUITY AND ENDING STATE
Keep exactly one lifter, one blue incline bench, two identical 105-pound dumbbells, the same clothing, headphones, body proportions, gym layout, staircase, equipment, lighting, and bystanders from first frame to last. Bystanders continue small ordinary real-time movements and never occlude the lift. End with the lifter holding both weights above his upper chest, feet still planted, camera unchanged.

CONSTRAINTS
No cuts, transitions, camera move, zoom, reframing, speed ramp, slow motion, time lapse, freeze, reverse, loop, repeated frames, or invented exercise. No barbell, extra dumbbell, changing plate count, floating weights, rubbery motion, hand swaps, duplicated limbs, fused fingers, warped anatomy, changing face, changing hair, changing clothes, disappearing people, teleporting equipment, or impossible physics. Do not generate captions, checklist text, subtitles, foreground typography, logos, watermarks, music, dialogue, or voice. Output picture only; the exact approved text overlay and source audio are added afterward."""

TEXT_PROMPT_SEEDANCE_CAPTIONS = TEXT_PROMPT.replace(
    "Do not generate captions, checklist text, subtitles, foreground typography, logos, watermarks, music, dialogue, or voice. Output picture only; the exact approved text overlay and source audio are added afterward.",
    """Render the complete caption block directly inside the generated video. The text must remain visible and unchanged for the full shot. Use bold white sans-serif lettering with a thick black outline, centered in the lower-middle of frame, with generous line spacing and no background box. Spell and punctuate every line exactly as follows, preserving this order and capitalization:

Getting lean is EASY.

Fast till noon.
Last meal at 8.
Whole foods only.
Water only.
10-12k steps.
Gym 4 times a week.
7-9 hrs sleep.

The heading sits above the seven-line list with a small gap. Keep the entire block legible, stable, uncropped, and clear of the lifter's face and dumbbells. Do not add, remove, reword, duplicate, animate, morph, or misspell any character. Do not generate any other foreground typography, subtitles, logos, watermarks, music, dialogue, or voice. The approved source audio is added afterward.""",
)


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: dict[str, Any]) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def duration_seconds(path: Path) -> float:
    output = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], text=True)
    return float(output.strip())


def vault_secret(service: str) -> str:
    keychain = Path.home() / "Library" / "Keychains" / "mc-vault-db"
    command = ["security", "find-generic-password", "-s", service, "-w"]
    if keychain.exists():
        command.append(str(keychain))
    completed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=30)
    secret = completed.stdout.strip() if completed.returncode == 0 else ""
    if not secret:
        raise RuntimeError("vault credential is unavailable")
    return secret


def is_content_policy_rejection(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if response is None or getattr(response, "status_code", None) != 422:
        return False
    try:
        body = response.json()
    except (TypeError, ValueError):
        return False
    details = body.get("detail", []) if isinstance(body, dict) else []
    return any(
        isinstance(detail, dict) and detail.get("type") == "content_policy_violation"
        for detail in details
    )


def generation_prompt(args: argparse.Namespace) -> str:
    if args.generation_mode == "reference":
        return REFERENCE_PROMPT
    return TEXT_PROMPT_SEEDANCE_CAPTIONS if args.caption_mode == "seedance" else TEXT_PROMPT


def build_spec(args: argparse.Namespace, source_hash: str) -> dict[str, Any]:
    model = TEXT_MODEL if args.generation_mode == "text" else REFERENCE_MODEL
    prompt = generation_prompt(args)
    spec = {
        "schemaVersion": "0.2.0",
        "sourceContentSha256": source_hash,
        "rightsAttestationMessageTs": args.rights_attestation_ts,
        "requestedChange": "none_exact_reconstruction",
        "analysisPromptVersion": "analysis-v2",
        "internalRoute": model,
        "referenceRole": (
            "prompt_from_source_forensics_no_media_reference"
            if args.generation_mode == "text"
            else "base_motion_composition_identity"
        ),
        "outputDurationSeconds": args.provider_duration,
        "finalDurationMs": args.final_duration_ms,
        "resolution": args.resolution,
        "aspectRatio": "9:16",
        "generatedAudio": False,
        "captionMode": args.caption_mode,
        "finishing": [f"trim_to_{args.final_duration_ms}ms", "restore_attested_source_audio"],
    }
    if args.caption_mode == "deterministic":
        spec["finishing"].append("render_exact_text_overlay")
    if args.generation_mode == "text":
        spec["generationPromptSha256"] = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    return spec


def estimate_cost(
    reference_seconds: float,
    output_seconds: int,
    resolution: str,
    generation_mode: str,
) -> tuple[float, float]:
    width, height = DIMENSIONS[resolution]
    input_seconds = reference_seconds if generation_mode == "reference" else 0
    tokens = width * height * (input_seconds + output_seconds) * 24 / 1024
    cost = tokens / 1000 * PRICE_PER_1K_TOKENS
    if generation_mode == "reference":
        cost *= VIDEO_REFERENCE_MULTIPLIER
    elif resolution == "480p":
        cost = max(cost, output_seconds * TEXT_480P_COST_PER_SECOND)
    return tokens, cost


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--expected-source-hash", required=True)
    parser.add_argument("--rights-attestation-ts", required=True)
    parser.add_argument("--expected-spec-hash", required=True)
    parser.add_argument("--max-cost-usd", type=float, required=True)
    parser.add_argument("--provider-duration", type=int, default=6)
    parser.add_argument("--final-duration-ms", type=int, default=5116)
    parser.add_argument("--resolution", choices=sorted(DIMENSIONS), default="480p")
    parser.add_argument("--generation-mode", choices=("reference", "text"), default="reference")
    parser.add_argument("--caption-mode", choices=("deterministic", "seedance"), default="deterministic")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.source = args.source.resolve()
    args.output_dir = args.output_dir.resolve()
    if not args.source.is_file():
        raise RuntimeError("source video is missing")
    source_hash = sha256(args.source)
    if source_hash != args.expected_source_hash:
        raise RuntimeError("source hash does not match the approved asset")
    reference_seconds = duration_seconds(args.source)
    spec = build_spec(args, source_hash)
    spec_hash = canonical_hash(spec)
    if spec_hash != args.expected_spec_hash:
        raise RuntimeError("spec hash does not match the approved estimate")
    billed_tokens, estimated_cost = estimate_cost(
        reference_seconds,
        args.provider_duration,
        args.resolution,
        args.generation_mode,
    )
    if estimated_cost > args.max_cost_usd:
        raise RuntimeError("estimated provider cost exceeds the approved cap")

    prepared = {
        "status": "dry_run" if args.dry_run else "prepared",
        "specHash": spec_hash,
        "spec": spec,
        "provider": "fal.ai",
        "model": spec["internalRoute"],
        "estimatedBilledTokens": round(billed_tokens, 3),
        "estimatedCostUsd": round(estimated_cost, 4),
        "maxApprovedCostUsd": args.max_cost_usd,
        "sourceDurationSeconds": reference_seconds,
        "sourcePath": str(args.source),
    }
    if args.dry_run:
        print(json.dumps(prepared, indent=2, sort_keys=True))
        return 0

    args.output_dir.mkdir(parents=True, exist_ok=True)
    state_path = args.output_dir / "generation-job.json"
    lock_path = args.output_dir / ".generation.lock"
    with lock_path.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if state_path.exists():
            existing = json.loads(state_path.read_text())
            if existing.get("status") in {
                "submitting", "submitted", "unknown_outcome", "rejected", "complete"
            }:
                raise RuntimeError(f"refusing duplicate paid submission in state {existing.get('status')}")
        atomic_json(state_path, prepared)

        import fal_client

        client = fal_client.SyncClient(key=vault_secret("fal-key"))
        prompt = generation_prompt(args)
        model = spec["internalRoute"]
        arguments = {
            "prompt": prompt,
            "resolution": args.resolution,
            "duration": str(args.provider_duration),
            "aspect_ratio": "9:16",
            "generate_audio": False,
            "bitrate_mode": "standard",
            "end_user_id": "cloneugc-phase0",
        }
        if args.generation_mode == "reference":
            reference_url = client.upload_file(args.source)
            prepared["referenceUploadUrl"] = reference_url
            arguments["video_urls"] = [reference_url]
            atomic_json(state_path, prepared)
        started = time.monotonic()
        prepared["status"] = "submitting"
        atomic_json(state_path, prepared)
        try:
            response = client._client.request(
                "POST",
                f"https://queue.fal.run/{model}",
                json=arguments,
                timeout=client.default_timeout,
            )
            response.raise_for_status()
            response_data = response.json()
            request_id = response_data["request_id"]
            handle = client.get_handle(model, request_id)
        except Exception as error:
            prepared.update({"status": "unknown_outcome", "errorType": type(error).__name__})
            atomic_json(state_path, prepared)
            raise RuntimeError("provider submission is uncertain; do not resubmit automatically") from None
        prepared.update({"status": "submitted", "providerRequestId": handle.request_id})
        atomic_json(state_path, prepared)
        print(json.dumps({"status": "submitted", "requestId": handle.request_id, "specHash": spec_hash}), flush=True)
        try:
            result = handle.get()
        except Exception as error:
            rejected = is_content_policy_rejection(error)
            prepared.update({
                "status": "rejected" if rejected else "unknown_outcome",
                "errorType": type(error).__name__,
            })
            if rejected:
                prepared["providerResolution"] = "content_policy_violation"
            atomic_json(state_path, prepared)
            message = (
                "provider rejected the reference under content policy; do not resubmit automatically"
                if rejected
                else "provider result is uncertain; do not resubmit automatically"
            )
            raise RuntimeError(message) from None

        video = result.get("video") if isinstance(result, dict) else None
        output_url = video.get("url") if isinstance(video, dict) else None
        if not output_url:
            prepared.update({"status": "unknown_outcome", "errorType": "MissingVideoUrl"})
            atomic_json(state_path, prepared)
            raise RuntimeError("provider completed without a video URL; do not resubmit automatically")
        raw_path = args.output_dir / "raw-seedance.mp4"
        urllib.request.urlretrieve(str(output_url), raw_path)
        prepared.update({
            "status": "complete",
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "outputUrl": output_url,
            "rawOutputPath": str(raw_path),
            "rawOutputSha256": sha256(raw_path),
            "providerSeed": result.get("seed") if isinstance(result, dict) else None,
        })
        atomic_json(state_path, prepared)
        print(json.dumps({"status": "complete", "requestId": handle.request_id, "output": str(raw_path)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BlockingIOError:
        print("generation job is already locked", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"generation failed safely: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
