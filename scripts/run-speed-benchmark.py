#!/usr/bin/env python3
"""Run a resumable static Gemini speed-classification lane over a corpus manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path


def parse_summary(summary: str) -> dict[str, object]:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", summary, re.DOTALL)
    payload = fenced.group(1) if fenced else summary.strip()
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise ValueError("model summary is not a JSON object")
    return parsed


def prompt_for(factor: float, evidence: dict[str, object] | None = None) -> str:
    base = (
        "The attached video is a deterministic inspection proxy made by stretching the delivered "
        f"source timeline by exactly {factor:.6f}x with repeated frames, no interpolation, and no audio. "
        "Infer whether the original delivered source before this inspection transform was real_time, "
        "sped_up, slowed_down, variable, or unknown. Do not infer from nominal FPS or editing energy. "
        "Inspect the full action cadence and ordinary physical motion. Estimate the original source "
        "playback multiplier relative to plausible natural motion only when defensible. Return only one "
        "minified JSON object with keys classification, estimatedMultiplier (number or null), confidence "
        "(0..1), evidence (array of at most 3 short strings)."
    )
    if evidence is None:
        return base
    compact = {
        "deliveredDurationMs": evidence["durationMs"],
        "deliveredFps": evidence["fps"],
        "frameDifferenceY": evidence["frameDifferenceY"],
        "nearDuplicateCadence": evidence["nearDuplicateCadence"],
        "blurMean": evidence["blurMean"],
        "meanDifferenceToBlurRatio": evidence["meanDifferenceToBlurRatio"],
    }
    return (
        base + " Deterministic measurements from the delivered source (before inspection expansion) are: "
        + json.dumps(compact, separators=(",", ":"))
        + " Treat them as supporting evidence, not fixed thresholds: periodic near-duplicates can indicate "
        "slowdown/frame duplication; unusually large inter-frame displacement relative to captured blur can "
        "indicate post-capture acceleration. Low-motion content, stabilization, frame-rate conversion, and "
        "encoding can mimic these signals, so reconcile them with visible semantics and return unknown on conflict."
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model", default="gemini-3.8-flash")
    parser.add_argument("--mode", choices=("static", "agentic"), default="static")
    parser.add_argument("--strategy", choices=("inspection_only", "inspection_evidence"), default="inspection_only")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--case", action="append", dest="case_ids")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = args.output_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    predictions: list[dict[str, object]] = []
    for case in manifest["cases"]:
        case_id = case["id"]
        if args.case_ids is not None and case_id not in args.case_ids:
            continue
        raw_path = raw_dir / f"{case_id}-r{args.repeat}.json"
        if raw_path.exists():
            outer = json.loads(raw_path.read_text())
        else:
            inspection = case["inspection"]
            evidence = None
            if args.strategy == "inspection_evidence":
                evidence_result = subprocess.run(
                    ["python3", str(Path(__file__).with_name("extract-temporal-evidence.py")), case["media"]["path"]],
                    capture_output=True, text=True,
                )
                if evidence_result.returncode != 0:
                    raise RuntimeError(f"{case_id} evidence failed: {evidence_result.stderr.strip()}")
                evidence = json.loads(evidence_result.stdout)
            command = [
                "mc", "video-analyze", inspection["path"], "--mode", args.mode,
                "--prompt", prompt_for(float(inspection["timeExpansionFactor"]), evidence), "--json",
            ]
            environment = dict(os.environ)
            environment["MC_VIDEO_ANALYSIS_MODEL"] = args.model
            result = subprocess.run(command, capture_output=True, text=True, env=environment)
            if result.returncode != 0:
                raise RuntimeError(f"{case_id} failed ({result.returncode}): {result.stderr.strip()}")
            outer = json.loads(result.stdout)
            raw_path.write_text(json.dumps(outer, indent=2) + "\n")
        parsed = parse_summary(str(outer["summary"]))
        predictions.append({
            "caseId": case_id,
            "predictedClass": parsed["classification"],
            "estimatedMultiplier": parsed.get("estimatedMultiplier"),
            "confidence": parsed["confidence"],
            "evidence": parsed.get("evidence", []),
            "provenance": {
                "model": outer["model"], "mode": outer["mode"], "latencyMs": outer["latency_ms"],
                "totalTokens": outer["total_tokens"], "contentSha256": outer["content_sha256"],
            },
        })
        print(f"{case_id}: {parsed['classification']} {parsed.get('estimatedMultiplier')}", flush=True)

    output = {
        "schemaVersion": "0.1.0",
        "model": args.model,
        "mode": args.mode,
        "strategy": args.strategy,
        "repeat": args.repeat,
        "predictions": predictions,
    }
    output_path = args.output_dir / f"predictions-r{args.repeat}.json"
    output_path.write_text(json.dumps(output, indent=2) + "\n")
    print(output_path)


if __name__ == "__main__":
    main()
