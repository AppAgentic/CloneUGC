#!/usr/bin/env python3
"""Prepare or execute a blinded, exact-once H3 Max Turbo image-to-video pair."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import fal_client


ROUTE = "minimax/h3-max-turbo/image-to-video"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def value_hash(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


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


def single_post(key: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"https://queue.fal.run/{ROUTE}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode())


def parser() -> argparse.Namespace:
    result = argparse.ArgumentParser()
    result.add_argument("image", type=Path)
    result.add_argument("control_prompt", type=Path)
    result.add_argument("compiler_prompt", type=Path)
    result.add_argument("output_dir", type=Path)
    result.add_argument("--expected-image-hash", required=True)
    result.add_argument("--source-video-hash", required=True)
    result.add_argument("--fidelity-map-hash", required=True)
    result.add_argument("--spend-approval-ts", required=True)
    result.add_argument("--replacement-image-approval-ts", required=True)
    result.add_argument("--duration", type=int, default=10)
    result.add_argument("--resolution", default="768P", choices=["480P", "768P"])
    result.add_argument("--per-call-cap-micros", type=int, required=True)
    result.add_argument("--aggregate-video-cap-micros", type=int, required=True)
    result.add_argument("--price-micros-per-second", type=int, required=True)
    result.add_argument("--price-snapshot-id", required=True)
    result.add_argument("--price-source-url", required=True)
    result.add_argument("--prepare", action="store_true")
    result.add_argument("--execute", action="store_true")
    result.add_argument("--enrich", action="store_true", help="read-only result reconciliation for completed receipts")
    return result.parse_args()


def prepare(args: argparse.Namespace) -> dict:
    image_hash = sha256(args.image)
    if image_hash != args.expected_image_hash:
        raise RuntimeError("setup image hash mismatch")
    if args.price_micros_per_second < 0 or not args.price_source_url.startswith("https://"):
        raise RuntimeError("pricing requires non-negative integer micros and an HTTPS source")
    estimated_per_call = args.duration * args.price_micros_per_second
    if estimated_per_call > args.per_call_cap_micros or estimated_per_call * 2 > args.aggregate_video_cap_micros:
        raise RuntimeError("estimated video cost exceeds approval cap")
    prompts = {
        "control": args.control_prompt.read_text().strip(),
        "compiler": args.compiler_prompt.read_text().strip(),
    }
    if not all(prompts.values()):
        raise RuntimeError("prompts must not be empty")
    order = ["control", "compiler"]
    secrets.SystemRandom().shuffle(order)
    slots = {order[0]: "A", order[1]: "B"}
    seed = secrets.SystemRandom().randrange(1, 2**31)
    base = {
        "schemaVersion": "0.1.0",
        "route": ROUTE,
        "setupImageSha256": image_hash,
        "sourceVideoSha256": args.source_video_hash,
        "fidelityMapSha256": args.fidelity_map_hash,
        "spendApprovalMessageTs": args.spend_approval_ts,
        "replacementImageApprovalMessageTs": args.replacement_image_approval_ts,
        "durationSeconds": args.duration,
        "resolution": args.resolution,
        "seed": seed,
        "promptExpansionMode": "balanced",
        "safetyChecker": True,
        "estimatedCostMicrosPerCall": estimated_per_call,
        "priceMicrosPerSecond": args.price_micros_per_second,
        "priceSnapshotId": args.price_snapshot_id,
        "priceSourceUrl": args.price_source_url,
        "perCallCapMicros": args.per_call_cap_micros,
        "aggregateVideoCapMicros": args.aggregate_video_cap_micros,
        "automaticSubmissionRetries": 0,
    }
    lanes = {lane: {"slot": slots[lane], "promptSha256": text_hash(prompts[lane])} for lane in order}
    sealed = {"base": base, "submissionOrder": order, "lanes": lanes}
    sealed["sealedPlanSha256"] = value_hash(sealed)
    return sealed


def submit(args: argparse.Namespace, sealed: dict, lane: str, client: fal_client.SyncClient, key: str, image_url: str) -> None:
    slot = sealed["lanes"][lane]["slot"]
    lane_dir = args.output_dir / f"slot-{slot}"
    lane_dir.mkdir(parents=True, exist_ok=True)
    state_path = lane_dir / "receipt.json"
    if state_path.exists() and json.loads(state_path.read_text()).get("status") in {"submitting", "submitted", "unknown_outcome", "complete"}:
        raise RuntimeError(f"refusing duplicate paid submission for slot {slot}")
    prompt_path = args.control_prompt if lane == "control" else args.compiler_prompt
    prompt = prompt_path.read_text().strip()
    record = {
        **sealed["base"], **sealed["lanes"][lane],
        "sealedPlanSha256": sealed["sealedPlanSha256"],
        "status": "submitting",
        "submittedAtUnixMs": int(time.time() * 1000),
    }
    atomic_json(state_path, record)
    payload = {
        "prompt": prompt,
        "duration": sealed["base"]["durationSeconds"],
        "resolution": sealed["base"]["resolution"],
        "seed": sealed["base"]["seed"],
        "enable_safety_checker": True,
        "prompt_expansion_mode": "balanced",
        "image_url": image_url,
    }
    try:
        response = single_post(key, payload)
        request_id = response.get("request_id")
        if not request_id:
            raise RuntimeError("provider response contained no request id")
    except Exception as error:
        record.update({"status": "unknown_outcome", "errorType": type(error).__name__})
        atomic_json(state_path, record)
        raise RuntimeError("submission outcome unknown; automatic retry forbidden") from None
    record.update({"status": "submitted", "providerRequestId": request_id})
    atomic_json(state_path, record)
    print(json.dumps({"slot": slot, "status": "submitted", "requestId": request_id}), flush=True)
    started = time.monotonic()
    while True:
        status = client.status(ROUTE, request_id, with_logs=False)
        status_name = type(status).__name__.upper()
        if status_name == "COMPLETED":
            break
        if status_name not in {"QUEUED", "INQUEUE", "INPROGRESS"}:
            record.update({"status": "provider_terminal", "providerStatus": status_name})
            atomic_json(state_path, record)
            raise RuntimeError(f"provider returned terminal status {status_name}")
        time.sleep(3)
    result = client.result(ROUTE, request_id)
    video_url = result.get("video", {}).get("url")
    if not video_url:
        record.update({"status": "completed_without_video"})
        atomic_json(state_path, record)
        raise RuntimeError("provider completed without video")
    output = lane_dir / f"candidate-{slot}.mp4"
    with urllib.request.urlopen(video_url, timeout=180) as response:
        output.write_bytes(response.read())
    record.update({
        "status": "complete",
        "completedAtUnixMs": int(time.time() * 1000),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "outputSha256": sha256(output),
        "outputPath": str(output),
        "expandedPrompt": result.get("expanded_prompt"),
        "expandedPromptSha256": text_hash(result.get("expanded_prompt") or ""),
        "providerTimings": result.get("timings"),
    })
    atomic_json(state_path, record)
    print(json.dumps({"slot": slot, "status": "complete", "output": str(output)}), flush=True)


def main() -> int:
    args = parser()
    if sum((args.prepare, args.execute, args.enrich)) != 1:
        raise RuntimeError("choose exactly one of --prepare, --execute, or --enrich")
    for name in ("image", "control_prompt", "compiler_prompt", "output_dir"):
        setattr(args, name, getattr(args, name).resolve())
    for path in (args.image, args.control_prompt, args.compiler_prompt):
        if not path.is_file():
            raise RuntimeError(f"missing input {path}")
    sealed_path = args.output_dir / "sealed-mapping.json"
    if args.prepare:
        if sealed_path.exists():
            raise RuntimeError("sealed mapping already exists")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        sealed = prepare(args)
        atomic_json(sealed_path, sealed)
        public = {**sealed["base"], "slots": ["A", "B"], "sealedPlanSha256": sealed["sealedPlanSha256"]}
        atomic_json(args.output_dir / "public-plan.json", public)
        print(json.dumps(public, indent=2, sort_keys=True))
        return 0
    sealed = json.loads(sealed_path.read_text())
    if sealed.get("sealedPlanSha256") != value_hash({k: v for k, v in sealed.items() if k != "sealedPlanSha256"}):
        raise RuntimeError("sealed mapping hash mismatch")
    expected_arguments = {
        "sourceVideoSha256": args.source_video_hash,
        "fidelityMapSha256": args.fidelity_map_hash,
        "spendApprovalMessageTs": args.spend_approval_ts,
        "replacementImageApprovalMessageTs": args.replacement_image_approval_ts,
        "durationSeconds": args.duration,
        "resolution": args.resolution,
        "perCallCapMicros": args.per_call_cap_micros,
        "aggregateVideoCapMicros": args.aggregate_video_cap_micros,
        "priceMicrosPerSecond": args.price_micros_per_second,
        "priceSnapshotId": args.price_snapshot_id,
        "priceSourceUrl": args.price_source_url,
    }
    if any(sealed["base"].get(field) != value for field, value in expected_arguments.items()):
        raise RuntimeError("runtime arguments differ from sealed plan")
    if sha256(args.image) != sealed["base"]["setupImageSha256"]:
        raise RuntimeError("setup image differs from sealed plan")
    prompt_hashes = {"control": text_hash(args.control_prompt.read_text().strip()), "compiler": text_hash(args.compiler_prompt.read_text().strip())}
    if any(prompt_hashes[lane] != sealed["lanes"][lane]["promptSha256"] for lane in prompt_hashes):
        raise RuntimeError("prompt differs from sealed plan")
    key = vault_secret("fal-key")
    client = fal_client.SyncClient(key=key)
    if args.enrich:
        for slot in ("A", "B"):
            state_path = args.output_dir / f"slot-{slot}" / "receipt.json"
            record = json.loads(state_path.read_text())
            if record.get("status") != "complete" or not record.get("providerRequestId"):
                raise RuntimeError(f"slot {slot} is not complete")
            result = client.result(ROUTE, record["providerRequestId"])
            expanded = result.get("expanded_prompt") or ""
            record.update({
                "expandedPrompt": result.get("expanded_prompt"),
                "expandedPromptSha256": text_hash(expanded),
                "providerTimings": result.get("timings"),
                "reconciledAtUnixMs": int(time.time() * 1000),
            })
            atomic_json(state_path, record)
        print(json.dumps({"status": "enriched", "slots": ["A", "B"]}))
        return 0
    image_url = client.upload_file(args.image)
    with (args.output_dir / ".pair.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for lane in sealed["submissionOrder"]:
            submit(args, sealed, lane, client, key, image_url)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BlockingIOError:
        print("pair is already locked", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"pair failed safely: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
