#!/usr/bin/env python3
"""Retest only corrected compiler units against an immutable accepted control lane."""

from __future__ import annotations

import argparse
import fcntl
import json
import runpy
import sys
from pathlib import Path


PAIR = runpy.run_path(str(Path(__file__).with_name("run-h3-multi-unit-blind-pair.py")))
ROUTE = PAIR["ROUTE"]
atomic_json = PAIR["atomic_json"]
resolve_units = PAIR["resolve_units"]
sha256 = PAIR["sha256"]
submit = PAIR["submit"]
text_hash = PAIR["text_hash"]
validate_lineage = PAIR["validate_lineage"]
value_hash = PAIR["value_hash"]
vault_secret = PAIR["vault_secret"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_video", type=Path)
    parser.add_argument("unit_manifest", type=Path)
    parser.add_argument("format_recipe", type=Path)
    parser.add_argument("fidelity_map_fixture", type=Path)
    parser.add_argument("prior_pair_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--accepted-control-slot", required=True, choices=["A", "B"])
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


def prior_control(args: argparse.Namespace, units: list[dict]) -> tuple[dict, list[dict]]:
    sealed_path = args.prior_pair_dir / "sealed-mapping.json"
    if not sealed_path.is_file():
        raise RuntimeError("prior pair sealed plan is missing")
    prior = json.loads(sealed_path.read_text())
    unsigned = {key: value for key, value in prior.items() if key != "sealedPlanSha256"}
    if prior.get("sealedPlanSha256") != value_hash(unsigned):
        raise RuntimeError("prior pair sealed plan hash mismatch")
    expected = {
        "route": ROUTE,
        "sourceVideoSha256": args.source_video_hash,
        "intendedSourceAssetId": args.intended_source_asset_id,
        "fidelityMapSha256": args.fidelity_map_hash,
        "resolution": args.resolution,
    }
    if any(prior.get(key) != value for key, value in expected.items()):
        raise RuntimeError("prior pair does not match the compiler retest lineage")
    if prior.get("laneSlots", {}).get("control") != args.accepted_control_slot:
        raise RuntimeError("accepted control slot does not match the unsealed prior mapping")
    manifest_state = json.loads(args.unit_manifest.read_text()).get("controlStateSha256")
    if prior.get("controlStateSha256") != manifest_state:
        raise RuntimeError("prior control and new compiler do not share the approved creative state")

    prior_by_id = {unit["id"]: unit for unit in prior.get("units", [])}
    accepted: list[dict] = []
    for unit in units:
        saved = prior_by_id.get(unit["id"])
        if not saved:
            raise RuntimeError(f"prior pair is missing unit {unit['id']}")
        if saved.get("setupImageSha256") != unit["imageSha256"] or saved.get("durationSeconds") != unit["durationSeconds"]:
            raise RuntimeError(f"prior control inputs differ for unit {unit['id']}")
        if saved.get("endImageSha256") != unit["endImageSha256"]:
            raise RuntimeError(f"prior control endpoint differs for unit {unit['id']}")
        control = saved.get("prompts", {}).get("control", {})
        if control.get("slot") != args.accepted_control_slot or control.get("sha256") != text_hash(unit["control"]):
            raise RuntimeError(f"prior control prompt differs for unit {unit['id']}")
        receipt_path = args.prior_pair_dir / unit["id"] / f"slot-{args.accepted_control_slot}" / "receipt.json"
        if not receipt_path.is_file():
            raise RuntimeError(f"accepted control receipt is missing for unit {unit['id']}")
        receipt = json.loads(receipt_path.read_text())
        video_path = Path(receipt.get("outputPath", ""))
        checks = (
            receipt.get("status") == "complete",
            receipt.get("sealedPlanSha256") == prior["sealedPlanSha256"],
            receipt.get("setupImageSha256") == unit["imageSha256"],
            receipt.get("promptSha256") == control["sha256"],
            receipt.get("seed") == saved.get("seed"),
            video_path.is_file(),
            video_path.is_file() and receipt.get("outputSha256") == sha256(video_path),
        )
        if not all(checks):
            raise RuntimeError(f"accepted control provenance is invalid for unit {unit['id']}")
        accepted.append({
            "id": unit["id"],
            "slot": args.accepted_control_slot,
            "seed": saved["seed"],
            "promptSha256": control["sha256"],
            "outputSha256": receipt["outputSha256"],
            "providerRequestId": receipt["providerRequestId"],
        })
    return prior, accepted


def build_plan(args: argparse.Namespace, units: list[dict], prior: dict, accepted: list[dict]) -> dict:
    billed_seconds = sum(unit["durationSeconds"] for unit in units)
    estimated_cost = billed_seconds * args.price_micros_per_second
    if estimated_cost > args.aggregate_video_cap_micros:
        raise RuntimeError("estimated compiler retest cost exceeds approval cap")
    if args.price_micros_per_second < 0 or not args.price_source_url.startswith("https://"):
        raise RuntimeError("pricing requires non-negative integer micros and an HTTPS source")
    prior_by_id = {unit["id"]: unit for unit in prior["units"]}
    plan = {
        "schemaVersion": "0.1.0",
        "kind": "compiler_only_retest",
        "route": ROUTE,
        "sourceVideoSha256": args.source_video_hash,
        "intendedSourceAssetId": args.intended_source_asset_id,
        "formatRecipeSha256": sha256(args.format_recipe),
        "fidelityMapFixtureSha256": sha256(args.fidelity_map_fixture),
        "fidelityMapSha256": args.fidelity_map_hash,
        "unitManifestSha256": sha256(args.unit_manifest),
        "controlStateSha256": prior["controlStateSha256"],
        "priorPairSealedPlanSha256": prior["sealedPlanSha256"],
        "acceptedControlSlot": args.accepted_control_slot,
        "acceptedControls": accepted,
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
        "units": [{
            "id": unit["id"],
            "durationSeconds": unit["durationSeconds"],
            "setupImageSha256": unit["imageSha256"],
            "endImageSha256": unit["endImageSha256"],
            "seed": prior_by_id[unit["id"]]["seed"],
            "prompts": {"compiler": {"slot": "compiler-retest", "sha256": text_hash(unit["compiler"])}},
        } for unit in units],
    }
    plan["sealedPlanSha256"] = value_hash(plan)
    return plan


def verify_plan(args: argparse.Namespace, plan: dict, units: list[dict], prior: dict, accepted: list[dict]) -> None:
    expected = build_plan(args, units, prior, accepted)
    if plan != expected:
        raise RuntimeError("runtime inputs differ from the sealed compiler retest plan")


def main() -> int:
    args = parse_args()
    if sum((args.prepare, args.execute, args.validate)) != 1:
        raise RuntimeError("choose exactly one of --prepare, --execute, or --validate")
    if not args.validate and not args.spend_approval_ts:
        raise RuntimeError("prepare and execute require an exact spend approval timestamp")
    for field in ("source_video", "unit_manifest", "format_recipe", "fidelity_map_fixture", "prior_pair_dir", "output_dir"):
        setattr(args, field, getattr(args, field).resolve())
    for path in (args.source_video, args.unit_manifest, args.format_recipe, args.fidelity_map_fixture):
        if not path.is_file():
            raise RuntimeError(f"missing input {path}")
    units = resolve_units(args.unit_manifest)
    validate_lineage(args, units)
    prior, accepted = prior_control(args, units)
    if args.validate:
        plan = build_plan(args, units, prior, accepted)
        print(json.dumps({
            "status": "valid",
            "providerCalls": len(units),
            "billedSeconds": sum(unit["durationSeconds"] for unit in units),
            "estimatedVideoCostMicros": plan["estimatedVideoCostMicros"],
            "reusedAcceptedControlUnits": len(accepted),
            "automaticSubmissionRetries": 0,
        }, indent=2, sort_keys=True))
        return 0
    sealed_path = args.output_dir / "sealed-plan.json"
    if args.prepare:
        if sealed_path.exists():
            raise RuntimeError("sealed compiler retest plan already exists")
        plan = build_plan(args, units, prior, accepted)
        atomic_json(sealed_path, plan)
        print(json.dumps(plan, indent=2, sort_keys=True))
        return 0
    plan = json.loads(sealed_path.read_text())
    verify_plan(args, plan, units, prior, accepted)
    key = vault_secret("fal-key")
    client = PAIR["fal_client"].SyncClient(key=key)
    with (args.output_dir / ".compiler-retest.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for unit in units:
            image_url = client.upload_file(unit["image"])
            end_image_url = client.upload_file(unit["endImage"]) if unit["endImage"] is not None else None
            submit(args, plan, unit, "compiler", client, key, image_url, end_image_url)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BlockingIOError:
        print("compiler retest is already locked", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"compiler retest failed safely: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
