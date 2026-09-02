export const SOURCE_FORENSICS_PROMPT_VERSION = "analysis-v4";

export const TEMPORAL_OBSERVER_PROMPT_VERSION = "temporal-observer-v1";

export const TEMPORAL_OBSERVER_PROMPT = `Observe temporal events in the complete inspection video. Do not classify playback speed, estimate a speed multiplier, or decide whether motion looks natural.

Return only directly visible event intervals. For each event include: id, type, clockId, inspectionStartMs, inspectionEndMs, confidence, directlyObserved, and a short description. Type must be exactly one of blink, gesture, gait_step, action_cycle, object_fall, physical_settling, camera_tremor, speech_phrase, mechanical_cycle, or other. Prefer events lasting at least one second in the inspection timeline: full gestures, gait steps or traversals, action cycles, object release-to-impact, physical settling, speech phrases, and mechanical cycles. Blinks and other sub-second micro-events are allowed only when their onset and offset are both visibly resolved.

Use different clockId values for physically independent scene layers or mechanisms. Do not split one action into multiple independent clocks. Do not use nominal FPS, editing energy, or a speed verdict as evidence. If an event boundary is hidden, sampled too coarsely, or inferred rather than seen, mark directlyObserved false. Return an empty event list when no useful event can be measured.`;

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

Also report narrative beats, subject/action/object state, framing and camera motion, lighting and setting, overlays and on-screen text, dialogue/music/sound, continuity dependencies, creative DNA, and identity/voice/logo/watermark/music/dialogue/bystander/minor transfer risks. Do not identify people. Conflicting or weak evidence must remain disputed and must not be silently promoted into reconstruction instructions.`;
