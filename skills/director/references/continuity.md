# Clip continuity handoff

Use this for dependent clips or an explicit latent/motion-context request. First decide whether the edit is a motivated cut, a visually matched cut, or temporal continuation. Use the selected previous output and the planned or user-reported ending state; verify the relevant installed node schema/template and preserve original identity references. If a material ending-state uncertainty affects the next shot, ask the user and use only the targeted evidence needed to resolve it. Continuation does not require routine visual grading of the prior clip. Do not pin the previous room/pose into an independent new-location or time-jump shot.

## Choose the verified Motion Context source

| Available source | Connection and limitation |
| --- | --- |
| Saved sampler-output latent for the selected previous take | Load that exact latent into the next clip's supported context input. Verify file existence, take provenance, resolution, model/VAE compatibility and temporal grid. Carry audio if required and supported. |
| Selected previous video/audio | Feed consecutive previous-video frames to `MotionContext.context_frames`, with `context_audio` and its audio VAE when supported. This multi-frame route is supported and preserves motion history; it is not the original sampler latent. Use the exact video filename, not an output prefix. |
| An ending image already available | It may help answer a specific question about the previous ending. It does not supply motion history and must not be promoted to a next-clip continuation input. There is no requirement to extract one. |
| No verified compatible source | Explain what is missing and propose inspection, a bridge/cut, or an authorized source-generation step. Mark continuity unverified rather than quietly generating another independent take. |

Check available inputs, not tool names. No workflow is bundled with the plugin. Reuse a verified graph already present in the current context or clip record, reading that selected graph directly. When it is missing or unsuitable, use `director_workflows` to list ComfyUI's saved workflows, inspect a candidate `workflow_name` or local `workflow_path`, and query only the relevant installed node `schema`. If no saved workflow fits, use Harness's native coding tools to find and adapt project graphs. Ask the user when materially different candidates or an unclear prior source prevent a confident choice. Submit the prepared API graph with `workflow` or `workflow_path`; structured `h3_prompt` overrides preserve its other connections. Authorized standalone workflow tests use their existing scope without adding a Director approval card; they may use `submit_comfy_job` with `intent: "generic"` for background monitoring and GPU handoff of applicable generic graphs. Actual H3 Ref2AV graphs retain their graph-specific checks.

Prefer compatible saved sampler latent when available. Honor a user-selected previous-video Motion Context route. If the user explicitly requires original sampler latent and it is missing, report the gap and obtain authorization before rerendering the previous clip to save it. A multi-frame video input must never be described as the original sampler latent.

## Example connection map, not a mandatory workflow

For installed H3 Motion Context nodes whose schema supports these ports:

```text
previous sampler output -> saved latent -> loader -> MotionContext.context_latent
current H3 conditioning -------------------------> MotionContext.conditioning
current H3 new latent ---------------------------> MotionContext.latent
current H3 new latent ---------------------------> current sampler.latent_image
MotionContext conditioning -> guider.conditioning -> current sampler
current sampler output -> video/audio decode -> context trim -> CreateVideo
MotionContext trim_frames ---------------------> context trim
current sampler output ------------------------> save current latent for the next link
```

Inspect the installed version for exact ports and ordering. Verify a loader actually reads the selected previous slot/file; a first-clip/no-context index is not continuation. Save into a separate current-clip slot without overwriting the selected prior latent. Match dimensions and frame rate, account for the carried/trimmed prefix when budgeting delivered duration, and keep video/audio trimming synchronized. Plan a plausible transition from the known or intended ending state into the next clip's first visible state after trimming. A close-up cannot instantly become a floor-level wide angle in a continuous take; budget a visible camera move or plan an explicit cut/bridge. Ask the user about any material actual-state uncertainty instead of launching a full visual audit. Context helps continuity; it does not guarantee identity or a seamless join.

For either Motion Context route, the carried prefix is removed by `MiniMaxH3MotionContextTrim`. Inspect `director_workflows` `generation_timing`: H3 aligns the requested frame count to its valid grid, then the trim removes the pinned frames. Write action timing against `delivered_seconds`, not the requested length or the untrimmed prefix. After rendering, verify actual video and required latent files, then display the result for the user's production review. Last-frame extraction, tail-frame Pictures and last-frame `MiniMaxH3AddGuide` anchoring are not Director continuation methods. Independent I2V/FLF generation remains available for tasks requesting those modes.

The previous-video route supplies consecutive frames through `context_frames` and optional sound through `context_audio`; do not replace it with one extracted tail-frame Picture. Use Harness native coding tools for video staging, not `director_stage_images`. Preserve approved identity and costume references. Verify `continuity.wiring` connects the previous source and MotionContext conditioning to the guider/sampler, with synchronized trim/output. A node that exists but is disconnected does not establish continuation.

The saved prior sampler latent feeds `MotionContext.context_latent`; the current clip's new H3 latent still feeds `sampler.latent_image`. Encoding a finished video with VAE creates a different latent, not the prior sampler output. Changing the current sampler's denoise value does not connect the previous take to this interface.

For versions where `clip_index: 0` means first-clip/no-load and positive indices identify saved clip slots, continuing saved clip 1 uses LoadLatent index 1 and SaveLatent index 2 for the current result. Verify these semantics rather than assuming them for every loader.

Before managed production, show the handoff source, selected mechanism, concrete binding, delivered duration and remaining limitations as part of shot/ref confirmation. Context imagery is separate from ordinary Picture order; never invent a Picture tag for an unconnected context input. Validate the actual prepared graph without queueing, then submit only within the approved scope. Once the required output and source files are technically verified, an already approved sequence may continue without an agent visual-acceptance gate. Assess the join visually when the user explicitly requests it; do not automatically extract review frames or regenerate a take for a suspected aesthetic defect.

When the user explicitly requires original sampler latent, pass `continuity_requirement: "sampler_latent"` to `submit_comfy_job` for both `validate_only` and final submission. The reported route must be `sampler_latent`; `video_frames` means a decoded video tail was re-encoded. A prior clip that never saved its sampler output cannot be promoted to an original latent by adding a loader to the next graph. If its saved latent is absent, stop that route, report the missing source and obtain authorization before the prior-clip rerender needed to create one.

For every dependent H3 clip, pass `continuity_requirement` matching the inspected route (`sampler_latent` or `video_frames`) on both calls. Record the inspected absolute API workflow path, `continuity_mode`, and `continuity_source` on the card in `clip_workflows`; if used, the list needs one entry per clip, with independent clips marked `none`. The submit gate compares these values with the prepared graph. Custom latent sockets remain `unverified_latent` until their installed schema and source provenance are checked; do not claim or submit them as verified sampler latent.
