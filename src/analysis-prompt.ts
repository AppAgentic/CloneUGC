export const SOURCE_FORENSICS_PROMPT_VERSION = "analysis-v6";

export const SOURCE_FORENSICS_PROMPT = `Analyze the complete reference video for reconstruction evidence. Return structured observations with normalized and original timestamps, confidence, and direct-observation versus inference labels.

Required timeline analysis:
- Report the exact delivered duration, shot count, every cut or gradual transition, and an ordered segment list. Each segment must include startMs, endMs, durationMs, source-shot identity, and transition-in type.
- Classify the video's overall playback as real_time, sped_up, slowed_down, variable, or unknown. Estimate the speed multiplier only when evidence supports it.
- Repeat the playback-rate classification for every segment. Cite observable cues such as motion cadence, gravity and settling, gait or blink cadence, camera shake, motion blur, audio pitch/cadence, duplicated or dropped frames, and discontinuities. Never infer speed from energy or editing style alone.
- Before classifying playback speed, discover at least two independent temporal anchors that actually exist in the clip. Candidates include foreground action or state changes, background people or objects, camera motion, gravity/settling, blinking or gait, mechanical motion, particles/fluids, and audio cadence. Do not require a repeated action or any clip-specific event type.
- For each selected anchor, timestamp observable sub-events, measure its wall-clock duration or displacement/cadence, compare it with a plausible natural-duration range, and state what speed class and multiplier it supports. Prefer anchors from different parts or layers of the scene so one unusual action cannot determine the result.
- Reconcile the independent anchors across the full timeline. Agreement across foreground and background supports a global classification; disagreement may indicate a local edit, speed ramp, compositing, naturally unusual motion, or insufficient evidence. Return unknown when fewer than two useful anchors exist or the evidence conflicts.
- Do not mistake native/captured frame rate for playback rate: 60 fps versus 24 fps changes temporal sampling, not synchronized wall-clock action duration. Treat dubbed music or audio pitch as supporting evidence only, never decisive evidence.
- Separate playback-rate changes from cuts, jump cuts, speed ramps, freeze frames, reverse motion, loop points, and ordinary fast subject movement. Mark uncertain classifications as unknown rather than forcing real time.
- Report segment lengths even when adjacent segments show the same subject or setting.

Required lighting analysis:
- Treat lighting as timestamped reconstruction evidence, not a generic mood adjective. Report the global lighting setup and any per-segment changes.
- Identify every visible light source or practical, its apparent direction and elevation, hardness or diffusion, relative intensity, falloff, and whether it affects the subject, background, or both.
- Describe color temperature and mixed color casts, exposure level, dynamic range, contrast, black level, highlight rolloff or clipping, shadow density, skin-tone rendering, reflections, and specular highlights.
- Timestamp passing lights, flicker, screen or dashboard glow, exposure/white-balance/HDR pumping, moving shadows, reflection changes, and any other illumination event that contributes to the clip's rhythm.
- Separate physical scene illumination from camera processing or grading: white balance, tint, saturation, tone curve, local HDR, denoising, sharpening, low-light grain, chroma noise, compression, and motion blur.
- Cite stable spatial evidence such as catchlights, cast-shadow direction, face-side brightness, practical-light positions, reflective surfaces, and background brightness. Mark inferred off-camera sources as inference.
- End with explicit preserve/change instructions for lighting geometry, temperature, exposure, contrast, dynamic events, and phone-camera artifacts. Use unknown when the source cannot support a conclusion.

Required secondary-motion and environmental-causality analysis:
- Audit every independently moving or deforming scene element across the full clip, not only the primary subject action. Check hair and flyaways, loose clothing and fabric, accessories, foliage, curtains, smoke/steam, liquids, particles, reflections, shadows, background people/objects, and handheld/environment vibration.
- For each observed motion field, timestamp onset, peak, direction, amplitude, cadence or frequency, phase/lag relative to the primary action, damping/settling, and stop time. Describe which screen regions and objects it affects.
- Infer the physical driver only from cross-element evidence: airflow or wind, gravity, vehicle inertia, contact/impact, vibration, fluid flow, heat, mechanical motion, or unknown. For example, coordinated hair flutter plus cabin cues may support airflow from an open window; hair motion alone does not prove the window state.
- Record causal chains explicitly as source -> force -> affected elements -> visible response, including coupled lighting/audio effects such as moving cast shadows, changing specular highlights, rustling, or microphone wind noise.
- Distinguish genuine secondary motion from motion blur, stabilization warp, compression shimmer, rolling shutter, frame interpolation, and generative artifacts. Mark an unseen cause as inference with confidence rather than direct observation.
- End with explicit preserve/change instructions for every material secondary-motion field. Return an evidence-backed none_observed result when no secondary motion exists; never omit the audit.

Also report narrative beats, subject/action/object state, framing and camera motion, lighting and setting, overlays and on-screen text, dialogue/music/sound, continuity dependencies, creative DNA, and identity/voice/logo/watermark/music/dialogue/bystander/minor transfer risks. Do not identify people. Conflicting or weak evidence must remain disputed and must not be silently promoted into reconstruction instructions.`;

export const COMPARATIVE_FIDELITY_PROMPT_VERSION = "comparison-v2";

export const COMPARATIVE_FIDELITY_PROMPT = `Compare the complete reference and reconstruction side by side using synchronized timestamps. Score motion timing, composition, subject/action continuity, lighting, text, and audio separately before giving an overall fidelity score.

For lighting fidelity, compare at matching timestamps:
- light-source direction, elevation, hardness, diffusion, intensity, and falloff;
- color temperature, mixed casts, exposure, contrast, black level, highlight rolloff or clipping, shadow density, skin-tone rendering, reflections, and specular response;
- every dynamic light event, including passing streetlights, practical flicker, screen/dashboard glow, moving shadows, and exposure/white-balance/HDR pumping;
- low-light phone texture, grain, chroma noise, denoising, sharpening, compression, and motion blur.

For secondary-motion fidelity, inventory every source motion field before checking the result: hair/flyaways, loose fabric, accessories, foliage, smoke/steam, liquids, particles, reflections, shadows, background motion, and vibration. Compare each field's onset, direction, amplitude, cadence/frequency, phase, damping, stop time, and physical driver. Verify causal coupling—for example airflow should move all exposed hair consistently and alter nearby shadows/speculars when visible. Treat a missing subtle motion field as a fidelity failure even when the primary action matches.

Separate scene-lighting mismatches from grading/camera-processing mismatches. Report each mismatch with its timestamp range, reference observation, result observation, severity, and a concrete repair instruction. Do not average lighting or secondary motion into general visual quality: return dedicated lighting and secondary-motion scores from 1 to 10 and state which facts matched. Mark uncertain comparisons as unknown rather than inventing measurements.`;
