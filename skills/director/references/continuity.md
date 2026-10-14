# Clip continuity handoff

Use this for dependent clips or an explicit latent/motion-context request. First decide whether the edit is a motivated cut, a visually matched cut, or temporal continuation. Inspect the actual previous ending and the relevant installed node schema/template; preserve original identity references. Do not pin the previous room/pose into an independent new-location or time-jump shot.

## Choose from actual available sources

| Available source | Connection and limitation |
| --- | --- |
| Saved sampler-output latent for the accepted previous take | Load that exact latent into the next clip's supported context input. Verify take provenance, resolution, model/VAE compatibility and temporal grid. Carry audio if required and supported. |
| Finished video/audio, but no saved sampler latent | Decode the relevant tail and use a supported context-frames/audio route; this re-encodes pixels and is not the original sampler latent. If the user requires the original latent, explain that it was not saved and ask before re-rendering the accepted clip to obtain it. |
| Reviewed ending image only | Use it for composition/pose matching through a supported image-conditioning route. A normal Ref2AV Picture conditions the whole clip, not an exact first frame or motion history. |
| No verified compatible source | Explain what is missing and propose inspection, a bridge/cut, or an authorized source-generation step. Mark continuity unverified rather than quietly generating another independent take. |

Check available inputs, not tool names. No workflow is bundled with the plugin. For context continuation, discover/adapt a capable local graph and submit it with `workflow` or `workflow_path`; structured `h3_prompt` overrides preserve its other connections.

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

Inspect the installed version for exact ports and ordering. Verify a loader actually reads the accepted previous slot/file; a first-clip/no-context index is not continuation. Save into a separate current-clip slot without overwriting an accepted prior latent. A decoded-tail route replaces the first line with frames into `context_frames` and, when needed, sound into `context_audio` with its audio VAE. Match dimensions and frame rate, account for the carried/trimmed prefix when budgeting delivered duration, and keep video/audio trimming synchronized. Context helps continuity; it does not guarantee identity or a seamless join.

For versions where `clip_index: 0` means first-clip/no-load and positive indices identify saved clip slots, continuing saved clip 1 uses LoadLatent index 1 and SaveLatent index 2 for the current result. Verify these semantics rather than assuming them for every loader.

Before generation, show the handoff source, selected mechanism, concrete binding, delivered duration and remaining limitations as part of shot/ref confirmation. Context imagery is separate from ordinary Picture order; never invent a Picture tag for an unconnected context input. Validate the actual prepared graph without queueing, then submit only within the approved scope. Afterward inspect both sides of the cut: pose, camera height/axis, screen direction, set/prop state, identity, wardrobe and sound.
