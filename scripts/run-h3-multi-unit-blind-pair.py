#!/usr/bin/env python3
"""Prepare or execute a source-bound, exact-once blinded H3 pair across many takes."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import fal_client


ROUTE = "minimax/h3-max-turbo/image-to-video"


def provider_duration_seconds(target_duration_ms: int) -> int:
    if not isinstance(target_duration_ms, int) or target_duration_ms <= 0:
        raise RuntimeError("target duration must be a positive integer")
    if target_duration_ms <= 5_500:
        return 5
    if target_duration_ms <= 11_000:
        return 10
    raise RuntimeError("target duration exceeds the supported near-real-time H3 window")


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
    path.parent.mkdir(parents=True, exist_ok=True)
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_video", type=Path)
    parser.add_argument("unit_manifest", type=Path)
    parser.add_argument("format_recipe", type=Path)
    parser.add_argument("fidelity_map_fixture", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--intended-source-asset-id", required=True)
    parser.add_argument("--source-video-hash", required=True)
    parser.add_argument("--fidelity-map-hash", required=True)
    parser.add_argument("--spend-approval-ts")
    parser.add_argument("--resolution", default="768P", choices=["480P", "768P"])
    parser.add_argument("--aggregate-video-cap-micros", type=int, required=True)
    parser.add_argument("--price-micros-per-second", type=int, required=True)
    parser.add_argument("--price-snapshot-id", required=True)
    parser.add_argument("--price-source-url", required=True)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--validate", action="store_true")
    return parser.parse_args()


def resolve_units(manifest_path: Path) -> list[dict]:
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schemaVersion") != "0.1.0" or not isinstance(manifest.get("units"), list):
        raise RuntimeError("invalid unit manifest")
    if not re.fullmatch(r"[a-f0-9]{64}", manifest.get("controlStateSha256", "")):
        raise RuntimeError("unit manifest requires a bound control state hash")
    root = manifest_path.parent
    result: list[dict] = []
    seen: set[str] = set()
    for raw in manifest["units"]:
        unit_id = raw.get("id")
        if not isinstance(unit_id, str) or not unit_id or unit_id in seen:
            raise RuntimeError("unit ids must be unique non-empty strings")
        seen.add(unit_id)
        duration = raw.get("durationSeconds")
        if duration not in {5, 10}:
            raise RuntimeError(f"unit {unit_id} duration must be 5 or 10 seconds")
        image = (root / raw.get("imagePath", "")).resolve()
        control = (root / raw.get("controlPromptPath", "")).resolve()
        compiler = (root / raw.get("compilerPromptPath", "")).resolve()
        for path in (image, control, compiler):
            if not path.is_file():
                raise RuntimeError(f"unit {unit_id} input is missing: {path}")
        end_image = (root / raw["endImagePath"]).resolve() if raw.get("endImagePath") else None
        if end_image is not None:
            if not end_image.is_file() or sha256(end_image) != raw.get("endImageSha256"):
                raise RuntimeError(f"unit {unit_id} endpoint image is missing or has the wrong hash")
            if not raw.get("endImageProvenance"):
                raise RuntimeError(f"unit {unit_id} endpoint image requires provenance")
        if sha256(image) != raw.get("imageSha256"):
            raise RuntimeError(f"unit {unit_id} setup image hash mismatch")
        control_text = control.read_text().strip()
        compiler_text = compiler.read_text().strip()
        if not control_text or not compiler_text:
            raise RuntimeError(f"unit {unit_id} prompts must not be empty")
        identity_visibility = raw.get("identityVisibility", "visible")
        end_identity_visibility = raw.get("endIdentityVisibility")
        identity_anchor = raw.get("identityAnchor")
        if identity_visibility not in {"visible", "fully_occluded"}:
            raise RuntimeError(f"unit {unit_id} has invalid identity visibility")
        if identity_visibility == "fully_occluded":
            if not isinstance(identity_anchor, str) or not identity_anchor.strip():
                raise RuntimeError(f"unit {unit_id} fully occluded setup requires an identity anchor")
            required_terms = set(re.findall(r"[a-z0-9]+", identity_anchor.lower()))
            for lane, prompt in (("control", control_text), ("compiler", compiler_text)):
                prompt_terms = set(re.findall(r"[a-z0-9]+", prompt.lower()))
                if not required_terms.issubset(prompt_terms):
                    raise RuntimeError(f"unit {unit_id} {lane} prompt is missing the identity anchor")
            if end_image is None or end_identity_visibility != "visible":
                raise RuntimeError(f"unit {unit_id} fully occluded start requires a visible endpoint identity anchor")
        result.append({
            "id": unit_id,
            "durationSeconds": duration,
            "image": image,
            "imageSha256": raw["imageSha256"],
            "imageProvenance": raw.get("imageProvenance", "existing operator-approved setup frame"),
            "endImage": end_image,
            "endImageSha256": raw.get("endImageSha256"),
            "endImageProvenance": raw.get("endImageProvenance"),
            "identityVisibility": identity_visibility,
            "identityAnchor": identity_anchor,
            "endIdentityVisibility": end_identity_visibility,
            "targetDurationMs": raw.get("targetDurationMs"),
            "maxAbsoluteRetimePercent": raw.get("maxAbsoluteRetimePercent"),
            "control": control_text,
            "compiler": compiler_text,
        })
    if not result:
        raise RuntimeError("unit manifest requires at least one generation unit")
    return result


def validate_lineage(args: argparse.Namespace, units: list[dict]) -> tuple[dict, dict]:
    recipe = json.loads(args.format_recipe.read_text())
    fixture = json.loads(args.fidelity_map_fixture.read_text())
    provenance = recipe.get("provenance") or {}
    map_value = fixture.get("map") or {}
    if provenance.get("sourceAssetId") != args.intended_source_asset_id:
        raise RuntimeError("format recipe does not belong to the intended source asset")
    if provenance.get("sourceFidelityMapHash") != args.fidelity_map_hash:
        raise RuntimeError("format recipe is not linked to the supplied Fidelity Map hash")
    if fixture.get("recipeId") != recipe.get("id") or map_value.get("sourceAssetId") != args.intended_source_asset_id:
        raise RuntimeError("Fidelity Map fixture does not belong to the intended recipe and source")
    if fixture.get("fidelityMapHash") != args.fidelity_map_hash or value_hash(map_value) != args.fidelity_map_hash:
        raise RuntimeError("Fidelity Map hash mismatch")
    if sha256(args.source_video) != args.source_video_hash or map_value.get("sourceContentSha256") != args.source_video_hash:
        raise RuntimeError("source video bytes do not match the Fidelity Map source")
    generation_units = [
        unit for unit in ((map_value.get("creatorWorkflow") or {}).get("generationUnits") or [])
        if unit.get("motionStrategy") != "deterministic_source"
    ]
    expected_ids = [unit.get("id") for unit in generation_units]
    actual_ids = [unit["id"] for unit in units]
    if expected_ids != actual_ids:
        raise RuntimeError("unit manifest must cover every generative Fidelity Map unit in order")
    for expected, actual in zip(generation_units, units, strict=True):
        target_duration_ms = expected.get("targetDurationMs", 0)
        required_duration = provider_duration_seconds(target_duration_ms)
        if actual["durationSeconds"] != required_duration:
            raise RuntimeError(f"unit {actual['id']} provider duration violates the near-real-time policy")
        if actual["targetDurationMs"] != target_duration_ms or actual["maxAbsoluteRetimePercent"] != 10:
            raise RuntimeError(f"unit {actual['id']} retiming contract differs from the Fidelity Map")
    return recipe, fixture


def prepare(args: argparse.Namespace) -> dict:
    if args.price_micros_per_second < 0 or not args.price_source_url.startswith("https://"):
        raise RuntimeError("pricing requires non-negative integer micros and an HTTPS source")
    units = resolve_units(args.unit_manifest)
    unit_manifest = json.loads(args.unit_manifest.read_text())
    recipe, fixture = validate_lineage(args, units)
    mapping = ["control", "compiler"]
    secrets.SystemRandom().shuffle(mapping)
    slots = {mapping[0]: "A", mapping[1]: "B"}
    total_seconds = sum(unit["durationSeconds"] for unit in units) * 2
    estimated_cost = total_seconds * args.price_micros_per_second
    if estimated_cost > args.aggregate_video_cap_micros:
        raise RuntimeError("estimated video cost exceeds approval cap")
    sealed_units = []
    for unit in units:
        sealed_units.append({
            "id": unit["id"],
            "durationSeconds": unit["durationSeconds"],
            "setupImageSha256": unit["imageSha256"],
            "endImageSha256": unit["endImageSha256"],
            "endImageProvenance": unit["endImageProvenance"],
            "imageProvenance": unit["imageProvenance"],
            "identityVisibility": unit["identityVisibility"],
            "identityAnchor": unit["identityAnchor"],
            "endIdentityVisibility": unit["endIdentityVisibility"],
            "targetDurationMs": unit["targetDurationMs"],
            "maxAbsoluteRetimePercent": unit["maxAbsoluteRetimePercent"],
            "seed": secrets.SystemRandom().randrange(1, 2**31),
            "prompts": {
                "control": {"slot": slots["control"], "sha256": text_hash(unit["control"])},
                "compiler": {"slot": slots["compiler"], "sha256": text_hash(unit["compiler"])},
            },
        })
    sealed = {
        "schemaVersion": "0.1.0",
        "route": ROUTE,
        "sourceVideoSha256": args.source_video_hash,
        "intendedSourceAssetId": args.intended_source_asset_id,
        "formatRecipeId": recipe["id"],
        "formatRecipeSha256": sha256(args.format_recipe),
        "fidelityMapFixtureSha256": sha256(args.fidelity_map_fixture),
        "fidelityMapSha256": args.fidelity_map_hash,
        "unitManifestSha256": sha256(args.unit_manifest),
        "controlStateSha256": unit_manifest["controlStateSha256"],
        "spendApprovalMessageTs": args.spend_approval_ts,
        "resolution": args.resolution,
        "promptExpansionMode": "balanced",
        "safetyChecker": True,
        "priceMicrosPerSecond": args.price_micros_per_second,
        "priceSnapshotId": args.price_snapshot_id,
        "priceSourceUrl": args.price_source_url,
        "aggregateVideoCapMicros": args.aggregate_video_cap_micros,
        "estimatedVideoCostMicros": estimated_cost,
        "automaticSubmissionRetries": 0,
        "laneSlots": slots,
        "submissionOrder": mapping,
        "units": sealed_units,
    }
    sealed["sealedPlanSha256"] = value_hash(sealed)
    return sealed


def verify_runtime(args: argparse.Namespace, sealed: dict, units: list[dict]) -> None:
    if sealed.get("sealedPlanSha256") != value_hash({key: value for key, value in sealed.items() if key != "sealedPlanSha256"}):
        raise RuntimeError("sealed mapping hash mismatch")
    unit_manifest = json.loads(args.unit_manifest.read_text())
    expected = {
        "sourceVideoSha256": args.source_video_hash,
        "intendedSourceAssetId": args.intended_source_asset_id,
        "formatRecipeSha256": sha256(args.format_recipe),
        "fidelityMapFixtureSha256": sha256(args.fidelity_map_fixture),
        "fidelityMapSha256": args.fidelity_map_hash,
        "unitManifestSha256": sha256(args.unit_manifest),
        "controlStateSha256": unit_manifest.get("controlStateSha256"),
        "spendApprovalMessageTs": args.spend_approval_ts,
        "resolution": args.resolution,
        "aggregateVideoCapMicros": args.aggregate_video_cap_micros,
        "priceMicrosPerSecond": args.price_micros_per_second,
        "priceSnapshotId": args.price_snapshot_id,
        "priceSourceUrl": args.price_source_url,
    }
    if any(sealed.get(key) != value for key, value in expected.items()):
        raise RuntimeError("runtime arguments differ from sealed plan")
    sealed_by_id = {unit["id"]: unit for unit in sealed["units"]}
    for unit in units:
        saved = sealed_by_id.get(unit["id"])
        if saved is None or saved["setupImageSha256"] != unit["imageSha256"]:
            raise RuntimeError(f"unit {unit['id']} setup image differs from sealed plan")
        if saved.get("endImageSha256") != unit["endImageSha256"]:
            raise RuntimeError(f"unit {unit['id']} endpoint image differs from sealed plan")
        for lane in ("control", "compiler"):
            if saved["prompts"][lane]["sha256"] != text_hash(unit[lane]):
                raise RuntimeError(f"unit {unit['id']} {lane} prompt differs from sealed plan")


def submit(args: argparse.Namespace, sealed: dict, unit: dict, lane: str, client: fal_client.SyncClient, key: str, image_url: str, end_image_url: str | None = None) -> None:
    saved = next(item for item in sealed["units"] if item["id"] == unit["id"])
    slot = saved["prompts"][lane]["slot"]
    receipt_path = args.output_dir / unit["id"] / f"slot-{slot}" / "receipt.json"
    if receipt_path.exists() and json.loads(receipt_path.read_text()).get("status") in {"submitting", "submitted", "unknown_outcome", "complete"}:
        raise RuntimeError(f"refusing duplicate paid submission for {unit['id']} slot {slot}")
    record = {
        "schemaVersion": "0.1.0",
        "sealedPlanSha256": sealed["sealedPlanSha256"],
        "unitId": unit["id"],
        "slot": slot,
        "setupImageSha256": unit["imageSha256"],
        "endImageSha256": unit["endImageSha256"],
        "promptSha256": saved["prompts"][lane]["sha256"],
        "seed": saved["seed"],
        "durationSeconds": saved["durationSeconds"],
        "estimatedCostMicros": saved["durationSeconds"] * sealed["priceMicrosPerSecond"],
        "status": "submitting",
        "submittedAtUnixMs": int(time.time() * 1000),
        "automaticSubmissionRetries": 0,
    }
    atomic_json(receipt_path, record)
    payload = {
        "prompt": unit[lane],
        "duration": saved["durationSeconds"],
        "resolution": sealed["resolution"],
        "seed": saved["seed"],
        "enable_safety_checker": True,
        "prompt_expansion_mode": "balanced",
        "image_url": image_url,
    }
    if end_image_url is not None:
        payload["end_image_url"] = end_image_url
    try:
        response = single_post(key, payload)
        request_id = response.get("request_id")
        if not request_id:
            raise RuntimeError("provider response contained no request id")
    except Exception as error:
        record.update({"status": "unknown_outcome", "errorType": type(error).__name__})
        atomic_json(receipt_path, record)
        raise RuntimeError("submission outcome unknown; automatic retry forbidden") from None
    record.update({"status": "submitted", "providerRequestId": request_id})
    atomic_json(receipt_path, record)
    print(json.dumps({"unit": unit["id"], "slot": slot, "status": "submitted", "requestId": request_id}), flush=True)
    started = time.monotonic()
    try:
        while True:
            status = client.status(ROUTE, request_id, with_logs=False)
            status_name = type(status).__name__.upper()
            if status_name == "COMPLETED":
                break
            if status_name not in {"QUEUED", "INQUEUE", "INPROGRESS"}:
                record.update({"status": "provider_terminal", "providerStatus": status_name})
                atomic_json(receipt_path, record)
                raise RuntimeError(f"provider returned terminal status {status_name}")
            time.sleep(3)
        result = client.result(ROUTE, request_id)
    except Exception as error:
        detail = str(error).lower()
        if "content_policy_violation" in detail:
            record.update({"status": "provider_terminal", "providerStatus": "CONTENT_POLICY_VIOLATION", "errorType": type(error).__name__})
            atomic_json(receipt_path, record)
            raise RuntimeError("provider accepted the request but returned a terminal content-policy result; retry forbidden") from None
        if record.get("status") != "provider_terminal":
            record.update({"status": "reconciliation_required", "errorType": type(error).__name__})
            atomic_json(receipt_path, record)
        raise RuntimeError("provider request requires reconciliation by persisted request id; automatic retry forbidden") from None
    video_url = (result.get("video") or {}).get("url")
    if not video_url:
        record.update({"status": "completed_without_video"})
        atomic_json(receipt_path, record)
        raise RuntimeError("provider completed without video")
    output = receipt_path.parent / f"candidate-{slot}.mp4"
    with urllib.request.urlopen(video_url, timeout=180) as response:
        output.write_bytes(response.read())
    expanded = result.get("expanded_prompt") or ""
    record.update({
        "status": "complete",
        "completedAtUnixMs": int(time.time() * 1000),
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "outputSha256": sha256(output),
        "outputPath": str(output),
        "expandedPromptSha256": text_hash(expanded),
        "providerTimings": result.get("timings"),
    })
    atomic_json(receipt_path, record)
    print(json.dumps({"unit": unit["id"], "slot": slot, "status": "complete", "output": str(output)}), flush=True)


def main() -> int:
    args = parse_args()
    if sum((args.prepare, args.execute, args.validate)) != 1:
        raise RuntimeError("choose exactly one of --prepare, --execute, or --validate")
    if not args.validate and not args.spend_approval_ts:
        raise RuntimeError("prepare and execute require an exact spend approval timestamp")
    for field in ("source_video", "unit_manifest", "format_recipe", "fidelity_map_fixture", "output_dir"):
        setattr(args, field, getattr(args, field).resolve())
    for path in (args.source_video, args.unit_manifest, args.format_recipe, args.fidelity_map_fixture):
        if not path.is_file():
            raise RuntimeError(f"missing input {path}")
    units = resolve_units(args.unit_manifest)
    validate_lineage(args, units)
    if args.validate:
        total_seconds = sum(unit["durationSeconds"] for unit in units) * 2
        estimated_cost = total_seconds * args.price_micros_per_second
        if estimated_cost > args.aggregate_video_cap_micros:
            raise RuntimeError("estimated video cost exceeds approval cap")
        print(json.dumps({
            "status": "valid",
            "unitCount": len(units),
            "providerCalls": len(units) * 2,
            "billedSeconds": total_seconds,
            "estimatedVideoCostMicros": estimated_cost,
            "automaticSubmissionRetries": 0,
        }, indent=2, sort_keys=True))
        return 0
    sealed_path = args.output_dir / "sealed-mapping.json"
    if args.prepare:
        if sealed_path.exists():
            raise RuntimeError("sealed mapping already exists")
        sealed = prepare(args)
        atomic_json(sealed_path, sealed)
        public = {key: value for key, value in sealed.items() if key not in {"laneSlots", "submissionOrder", "units"}}
        public["units"] = [{"id": unit["id"], "durationSeconds": unit["durationSeconds"], "setupImageSha256": unit["setupImageSha256"], "seed": unit["seed"]} for unit in sealed["units"]]
        public["slots"] = ["A", "B"]
        atomic_json(args.output_dir / "public-plan.json", public)
        print(json.dumps(public, indent=2, sort_keys=True))
        return 0
    sealed = json.loads(sealed_path.read_text())
    verify_runtime(args, sealed, units)
    key = vault_secret("fal-key")
    client = fal_client.SyncClient(key=key)
    with (args.output_dir / ".pair.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for unit in units:
            image_url = client.upload_file(unit["image"])
            end_image_url = client.upload_file(unit["endImage"]) if unit["endImage"] is not None else None
            for lane in sealed["submissionOrder"]:
                submit(args, sealed, unit, lane, client, key, image_url, end_image_url)
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
