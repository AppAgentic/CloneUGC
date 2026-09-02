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


MODEL = "bytedance/seedance-2.5/reference-to-video"
PRICE_PER_1K_TOKENS = 0.0214
VIDEO_REFERENCE_MULTIPLIER = 0.6
DIMENSIONS = {"480p": (496, 864), "720p": (720, 1280)}
PROMPT = """Use @Video1 as the sole rights-cleared base reference. Reconstruct the same vertical gym moment as faithfully as possible: the same approved adult lifter identity and physique, black shirt, light sweatpants, headphones, incline bench, two 105-pound dumbbells, low wide phone-camera framing, commercial gym layout, lighting, natural bystander paths, and real-time incline-press motion. Preserve one continuous take with no cuts, transitions, speed ramps, slow motion, time lapse, freeze, reverse, camera move, or invented action. Match the source motion timing through the first 5.116 seconds; any remaining generated tail should simply hold the ending action naturally. Do not add a checklist, subtitles, captions, watermark, or new text—the approved overlay and source audio will be restored deterministically after generation. No beautification, cinematic relighting, stylization, face morphing, anatomy distortion, extra people, extra equipment, or changed wardrobe."""


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


def build_spec(args: argparse.Namespace, source_hash: str) -> dict[str, Any]:
    return {
        "schemaVersion": "0.2.0",
        "sourceContentSha256": source_hash,
        "rightsAttestationMessageTs": args.rights_attestation_ts,
        "requestedChange": "none_exact_reconstruction",
        "analysisPromptVersion": "analysis-v2",
        "internalRoute": MODEL,
        "referenceRole": "base_motion_composition_identity",
        "outputDurationSeconds": args.provider_duration,
        "finalDurationMs": args.final_duration_ms,
        "resolution": args.resolution,
        "aspectRatio": "9:16",
        "generatedAudio": False,
        "finishing": [
            f"trim_to_{args.final_duration_ms}ms",
            "restore_attested_source_audio",
            "render_exact_text_overlay",
        ],
    }


def estimate_cost(reference_seconds: float, output_seconds: int, resolution: str) -> tuple[float, float]:
    width, height = DIMENSIONS[resolution]
    tokens = width * height * (reference_seconds + output_seconds) * 24 / 1024
    cost = tokens / 1000 * PRICE_PER_1K_TOKENS * VIDEO_REFERENCE_MULTIPLIER
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
    billed_tokens, estimated_cost = estimate_cost(reference_seconds, args.provider_duration, args.resolution)
    if estimated_cost > args.max_cost_usd:
        raise RuntimeError("estimated provider cost exceeds the approved cap")

    prepared = {
        "status": "dry_run" if args.dry_run else "prepared",
        "specHash": spec_hash,
        "spec": spec,
        "provider": "fal.ai",
        "model": MODEL,
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
        reference_url = client.upload_file(args.source)
        prepared["referenceUploadUrl"] = reference_url
        atomic_json(state_path, prepared)
        started = time.monotonic()
        prepared["status"] = "submitting"
        atomic_json(state_path, prepared)
        try:
            response = client._client.request(
                "POST",
                f"https://queue.fal.run/{MODEL}",
                json={
                    "prompt": PROMPT,
                    "video_urls": [reference_url],
                    "resolution": args.resolution,
                    "duration": str(args.provider_duration),
                    "aspect_ratio": "9:16",
                    "generate_audio": False,
                    "bitrate_mode": "standard",
                    "end_user_id": "cloneugc-phase0",
                },
                timeout=client.default_timeout,
            )
            response.raise_for_status()
            response_data = response.json()
            request_id = response_data["request_id"]
            handle = client.get_handle(MODEL, request_id)
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
