---
name: director
description: Use when a DSH video task needs shot planning, reference casting, workflow selection or interface wiring, or diagnosis of H3 motion and latent continuity.
---

# DSH Video Director

Turn the user's requested deliverable into a directed shot plan and feasible generated clips before writing model prompts. Preserve creative judgment and the user's requested scope; a story is not automatically a batch job.

## Production sequence

This sequence applies to managed Director production with a shot/reference proposal. An already authorized standalone workflow test, debugging task or coding task follows the user's requested scope and does not need a Director approval card. Native coding tools remain available for inspection and adaptation; `submit_comfy_job` with `intent: "generic"` can provide background submission and GPU handoff for an applicable generic workflow.

1. Reuse the relevant verified workflow already present in the current context or clip record. Inspect its capabilities, timing and canvas, and inspect the actual reference images. Use `director_workflows inspect` for this planning check when needed; it does not require a final generation prompt or an approved card. Discover other workflows only when the current one is missing or unsuitable.
2. Show the readable shot/reference proposal and stop for confirmation. Settle framing, reference casting, duration and dialogue here. Do not write the six-section final H3 prompt or run production preflight merely to obtain the first card.
3. After confirmation, compile that specific card's clip into its final prompt and API graph. Supply the returned `card_id` and the selected `clip_id` to both `submit_comfy_job validate_only` and the real submission. Keep the same binding across a technical repair.
4. Read `submission_ready`, `status`, and `issues`. `status: "blocked"` means no job was queued. Follow the concrete repair or confirmation action once; `retry_identical: false` forbids an unchanged retry. Do not recreate the same card to repair a submission argument or a workflow socket.
5. Verify the actual output file and technical metadata, then show its playable media card. The user reviews production quality. Continue an already approved sequence when its technical dependencies are ready; otherwise finish with the delivered result. Visual grading, frame extraction and corrective regeneration are not default completion steps.

The card's `workflow_path` records the inspected template. Saving its compiled execution copy elsewhere does not change the approved creative plan or require another confirmation. Submission records both paths in `review_binding`; references, canvas, delivered duration, dialogue, continuity route and source must still match the same approved clip. For H3 timing, set the graph's actual `length` to the helper's recommended 17k+5 frame count; inspect the edited graph rather than claiming an old template length rounds down.

To recover or show the current card, call `director_show_media` with `card_id: "latest"`, or the known card ID. This reuses the stored card and its approval; it is not a revision. Use the returned `review_status` to distinguish confirmed, awaiting confirmation and changes requested. Human confirmation may come from the card's Confirm button or a clear chat reply. A compacted model summary is not the authority for approval; recover the stored card before asking the user to repeat a decision.

## Enter at the current task

Choose the next action from the latest user request **and the current shot/ref proposal**, not from the full list of available capabilities:

- A standalone ComfyUI workflow inspection, debugging task, or generation test without a Director production proposal: use Harness's native coding tools to inspect, adapt and verify the workflow. `director_workflows` can help with discovery, and `submit_comfy_job` with `intent: "generic"` can submit applicable generic workflows with background monitoring and GPU handoff. Director cards and their approval gates apply only to managed Director production. Generic intent preserves ordinary workflow capability; it does not bypass graph-specific validation of an actual H3 Ref2AV graph.
- Discussion or shot planning: work on the creative decision; inspect only relevant assets/capabilities.
- Find, show or change references: query `director_assets` when the source is not already known, inspect selected images, then update the affected proposal. Do not rebuild the workflow for an asset-only change.
- Generate an approved clip: reuse the verified workflow, stage selected references, write the model prompt, preflight, then submit when `submission_ready` is true. A graph-valid result may still have `submission_blockers`.
- Diagnose an output: inspect that output and its actual conditioning before proposing a targeted repair.
- A new workflow, missing capability or explicit setup request: list saved ComfyUI workflows with `director_workflows`, inspect the selected graph and installed node interface, then use Harness's native coding tools to adapt an API graph. Return to the production task when the capability works.

These are routes, not tool restrictions. Recheck only capabilities affected by a change or failure. Keep the selected workflow path and settings with the clip record so compaction does not require rediscovery.

For a small edit to the latest review card, use `director_edit_review` with its `base_card_id`, a new version and `operation` (`add`, `replace`, `remove` or `shots`). Inspect its pixels: an actual user-uploaded image visible in the current context can be used directly; use native `read_image` for other files or an image compacted away. Add/replace inputs include `path` and `responsibility` (which character or visual fact this image controls); add also needs `shot_ids`, replace/remove needs the displayed `reference_number`. Add appends: actor, scene, then costume is valid.

A reference change updates the **actual card**, including its responsibilities and any contradictory shot wording. When the user changes clothing but keeps the shot, retain the action, dialogue, duration and framing; change the wardrobe wording through `shot_changes`. If an earlier image also controls the replaced costume, include `reference_changes` narrowing it to its remaining responsibility (for example `{reference_number:1,responsibility:"Actor identity only"}`). These changes belong in the same call. Use a full `director_show_media` proposal for structural changes or a legacy card without `card_id`; preserve unaffected files and their displayed order. Read the returned card before summarizing: the reply describes that stored result, not changes you intended but omitted. A successful call already displays the complete card; briefly request confirmation, then stop.

## Recover and reuse assets

Call `director_assets` before searching for previously uploaded references. It recovers native uploads from this session's durable history, including extensionless files. Use returned `source_path` exactly; never add a filename suffix. If a label query misses, list unlabelled assets before claiming an image is absent.

For a user-provided folder, use native tools to list that folder and inspect relevant images, then register selected paths. After seeing pixels (current upload or `read_image`), register supported `roles`, `observation` and `shot_ids`; labels aid retrieval and do not replace pixels or approval. `changed`, `missing` and `unmapped` require repair/reinspection, not guessed contents. Current-upload reuse verifies active native image context and unchanged attachment bytes; it does not waive the separate `read_image` evidence required for H3 submission. Use `director_stage_images` to obtain the separate ComfyUI filename. Do not confuse source paths, library labels and staged bindings.

## Clips and shots are different

- A **clip** is one generated video output or ComfyUI generation job.
- A **shot** is a directed visual beat or camera setup. One clip may contain one shot or a small feasible sequence of internal shots.
- If the user specifies how many videos or clips to generate, produce that many outputs. This does not make the user responsible for planning their shots.
- The director agent decides and explains the shot structure, pacing, framing, action, and transitions inside and across those clips.
- If the user does not specify an output count, recommend a clip count from the story, workflow duration, and continuity needs. If a requested clip count is impractical, recommend an alternative without silently changing the requested output count.
- Do not enqueue extra clips merely because the shot plan contains several shots.

## Workflow guidance from the user

Treat a user-specified workflow, model family, or known-good template as a high-priority production constraint. Inspect its installed schema and capabilities, then adapt its inputs for the shot; do not silently replace it with a different workflow merely because another one is easier to discover.

The user may provide only a partial operational hint such as "use the local Qwen Image Edit workflow for Layout." The agent remains responsible for locating the local workflow, verifying its nodes and models, staging references, setting output count and dimensions, and choosing safe parameters. If the named workflow is missing or cannot satisfy the shot, explain the concrete mismatch and recommend an alternative before substitution.

Start with a verified workflow in the current context or the clip record: read that selected graph and reuse it when it fits. A known path does not need a new inventory search. When that graph is unavailable or unsuitable, discover local candidates and check the relevant installed interfaces. If several materially different candidates fit without a clear user preference, or the intended previous source is unclear, ask the user before choosing. Keep machine-specific paths, API mechanics, and workflow inventories out of this skill; those belong to the coding agent's local inspection.

When discovery is needed, use `director_workflows` with `action: "list"` to see workflows saved in ComfyUI, `recent_workflows` recovered from this session's previous submissions (including after context compaction), and validated `workspace_candidates` at the current workspace root. Inspect a matching recent or root candidate `workflow_path` before searching deeper. For a named saved workflow, use `action: "inspect"` and its `workflow_name`; for a known workspace JSON, inspect its `workflow_path`. If the saved file is a UI canvas graph, export or construct an API graph before submission. If no listed candidate fits, use Harness's native `rg --files` inside the relevant project directory to find likely API JSONs. Match both project-name variants and clip identifiers: C3 may appear as `clip3`, `shot3`, or `take3`, and character names may be translated or romanized. Do not enter unrelated project directories or repeatedly search the entire workspace recursively when a narrow search misses. If the project identity or prior clip path is unavailable, ask for it before choosing a workflow. Use `action: "schema"` with one relevant installed `node_type` to check its real sockets, and reuse that schema during the task. Trace links from the previous source through conditioning, sampler, trim, and output; a matching filename alone does not prove the graph uses that source. Keep a copy of the chosen API graph with the clip record.

For a saved UI canvas result, use the inspector's exact `download_url` with Harness native coding tools to save a local JSON copy. Read its actual nodes, links, widget values and the installed schemas before building the API graph. Do not guess a filesystem location for a ComfyUI `workflow_name` or search the web for the local ComfyUI endpoint.

If `director_workflows` `list` reports `comfy_error`, the Config UI inventory is unavailable; inspect its returned local candidate paths and continue with Harness native coding tools.

For a read-only workflow diagnosis, `director_workflows` `inspect` is the first graph check: its `continuity.mode` identifies decoded-video, saved-latent, or absent context without needing `h3_review`, reference searches, or a ComfyUI submission. Use its `continuity.wiring` to describe actual source, context, conditioning, and trim edges; do not infer node order from names or invent a reverse connection. Inspect one named graph and only the schemas needed to resolve a specific ambiguous connection. Use `submit_comfy_job` validation later, when a prepared graph and production review record actually exist.

## Feasibility before prompting

Inspect the selected ComfyUI workflow before assigning timing. Compute the actual clip duration from its frame count and frame rate. Every action interval in the generation prompt must fit inside that duration.

Give each generated clip a coherent dramatic purpose. Plan its internal shots only when the model and duration can support them. A location change, major time jump, incompatible reference state, or complex multi-stage action may justify recommending another clip, but does not remove the agent's responsibility to design the best feasible shots for the user's chosen output count.

Budget for perception, not only timestamp arithmetic. A decisive reveal, reaction, or continuity state needs enough stable screen time for the audience to read it, plus a plausible camera or blocking transition into and out of it. If those holds and transitions do not fit, simplify the action, reduce the number of setups, or recommend another clip.

A continuous take has one physically continuous camera path. Changing from wide to close-up to reaction to a new wide is not a continuous take unless the planned camera movement and subject blocking visibly connect those framings. Otherwise call them separate shots and evaluate whether the clip can support the cuts.

## Rough concept to directed shots

Treat a rough concept as source material, not as a finished shot list. Infer the dramatic progression, then design the shots that make it readable on screen. Preserve the user's premise and avoid adding unrelated plot, characters, or spectacle merely to fill time.

Before prompting a model, identify:

- the setup, change or escalation, decisive visual beat, and ending image;
- what the audience must understand in each beat;
- the minimum number of camera setups needed to communicate those beats clearly;
- which beats can coexist in one feasible continuous clip and which require a cut or a separate generated clip;
- the visual and continuity facts that must survive from one shot or clip to the next.

The user chooses how many deliverable clips they want when they specify a count. The director still chooses the shot structure within those clips. Do not convert every story sentence into a separate clip, and do not force a fixed shot length.

## Visual reference casting

Inspect candidate images before assigning them. Never infer their contents from filenames, folders, or prompt history. If an image cannot be viewed reliably, do not cast it and say what evidence is missing.

For each visible candidate, record only supported facts and classify its useful responsibility as one or more of: Actor identity, Costume, Scene, Prop, Layout/composition, or Continuity state. Then choose the smallest ordered reference set that gives the model the visual facts required for the clip.

- Prefer one clear responsibility per reference. Explain any intentional overlap.
- Detect conflicts in identity, wardrobe, environment, lighting, screen direction, pose, prop state, and composition before generation.
- Reuse a reference across clips only when its visible state remains valid.
- A portrait establishes wardrobe only where an actual garment is visible. Cropped or faded shoulders do not establish an outfit. When clothing is unspecified, choose a simple outfit in the shot as a creative decision, separate from observed image facts; no extra costume image is required. Removing a costume reference retains or revises that written choice, not an invented outfit "from the portrait".
- A Layout reference should express composition, relative placement, and scene geography for the intended shot. It is not automatically required.
- Treat reflections, mirrors, screens-within-screens, exact eyelines, precise foreground/background placement, and similarly ambiguous spatial effects as high Layout-risk. Use a Layout/composition reference when prose alone leaves the intended relationship open to a materially different reading; otherwise simplify the staging until the relationship is unambiguous.
- Generate or request a missing Actor, Costume, Scene, Prop, or Layout reference only when that missing visual fact materially threatens the shot. Do not create filler references.
- When creating a missing reference, keep already established character and story facts consistent and inspect the result before casting it.
- Pass the inspected reference cast and visual responsibilities to H3 prompt writing in the same image-capable session. Do not turn the production step into a blind “submit immediately, do not inspect images” task. Keep the approved original actor references as identity evidence when using generated Layouts; review any drift before those images become new conditioning.

## Shot plan

For every requested clip, the director agent decides:

- dramatic purpose and actual duration;
- the number and order of internal shots or whether a continuous take is stronger;
- framing, camera behavior, blocking, action, and sound;
- ordered Picture and Audio references, with one responsibility per reference;
- incoming state and ending state needed for continuity;
- transition strategy: motivated cut, matched composition, compatible Layout, bridge shot, or Motion Context for temporal continuation (compatible saved sampler latent preferred; previous-video multi-frame context also supported).

All H3 Pictures condition the whole clip. Do not assign a reference image to a timestamp or call it a keyframe. When references are incompatible, redesign the shot or recommend separate clips; do not silently add outputs.

For a dependent clip, or a request to continue, connect shots, or use latent/motion context, read [continuity handoff](references/continuity.md) before selecting a workflow or writing its prompt. State a `continuity_handoff`: the selected previous output, planned or user-reported ending state, chosen mechanism, available source (saved sampler latent or the selected previous video/audio), actual workflow binding, compatibility checks and any missing source/approval. Explain the connection and next step to the user in plain language. Prefer compatible saved sampler-latent Motion Context for temporal continuation. The selected previous clip can also supply consecutive frames to MotionContext.context_frames, with audio when supported; this multi-frame motion history is a supported route, distinct from a single extracted frame. Do not extract a single previous last frame as a Picture or AddGuide anchor for continuation. Independent I2V and FLF tasks remain ordinary workflow capabilities. Independent cuts do not require context carryover. Workflow discovery and wiring remain Harness's native coding work, not a fixed template imposed by this skill.

For a dependent H3 clip, set `continuity_requirement` to the inspected route: `sampler_latent` for saved sampler output (preferred when compatible and available), or `video_frames` for consecutive previous-video frames through MotionContext. Honor a user-requested previous-video route. If the user explicitly requires the original saved sampler latent and it is absent, report that gap and obtain authorization before rerendering the previous clip; do not relabel video-derived context as the original latent. Check `continuity.mode`, its source and `submission_ready` before claiming the handoff is wired.

When diagnosing a submitted H3 prompt, use the tool's `h3_effective_prompt` or ComfyUI history for that prompt ID. A structured `h3_prompt` override changes only the submitted copy; the source `workflow_path` remains untouched. Reading that source later does not establish what the model actually received.

Use a compact record for each planned clip:

- `clip_id`, `dramatic_purpose`, and `duration`;
- ordered `shots`, each with framing, camera, blocking/action, sound, incoming state, ending state, and transition;
- ordered `reference_cast`, each with source, Picture index, visible responsibility, and the shots it supports;
- `missing_reference_decision`: none, or the single next reference/Layout that must be created and why.

This record is a reasoning and handoff aid, not a demand that the user pre-plan the production.

## User confirmation before production

For managed Director production, after inspecting references and planning shots, present a versioned shot-and-reference proposal and end the turn awaiting the user's confirmation. This gate does not add a card requirement to an authorized standalone workflow regression test or coding task. The proposal contains:

- deliverable clip count and each shot's characters, setting, framing, action, exact dialogue/language, actual duration, and incoming/ending state and transition;
- each clip's ordered Picture/Audio list with the actual image preview or accessible image link, source filename, named subject, assigned responsibility, and supported shots;
- missing references or Layouts, visible conflicts, and any proposed reference-generation step. Mark unavailable images as pending rather than approved.

The agent designs the shots; the user reviews them, not supplies the shot planning. Keep the proposal creative and readable, not a dump of workflow JSON. Ask the user to confirm the displayed version or specify revisions.

Build the initial card in one `director_show_media` call: `items` contains **every selected image** in displayed order, each shot's `reference_numbers` points into that same list, and spoken words go in `dialogue`. A planned or described scene image is not bound until its file is in `items`. Reference categories are responsibilities, not a checklist of mandatory uploads; `pending_references` lists genuinely required missing images, not optional wardrobe choices or general production advice.

A previous clip used as a workflow video or motion-context input is not a Picture on the shot/ref card. Verify its graph socket and source separately; do not copy a statement about that video into `pending_references`. If review validation reports an unexpected blocker, diagnose its saved card and user-event provenance. Never bypass the review gate with a raw ComfyUI `/prompt` request.

Before showing the final card, inspect `generation_timing`: compare the sum of shot durations with `delivered_frames / fps` after H3 frame alignment and context trimming, allowing at most one frame of rounding. H3 `length` is the raw pretrim request, not the delivered frame count; do not copy `delivered_frames` into `length` when MotionContextTrim removes context frames. Include the graph's actual output canvas in `clip_dimensions`, and number only the Pictures actually bound to H3. Submit through `submit_comfy_job` after `validate_only` reports `submission_ready: true`; its background job handles monitoring, so never keep a turn occupied with a PowerShell `/history` sleep loop.

Within managed Director production, only an explicit user confirmation of that displayed shot/ref proposal, through its Confirm button or a chat reply, authorizes final H3 prompt writing and video submission for its stated scope. An initial request to make a production video, urgency, permission for an unrelated test, or the agent's own approval does not satisfy this gate. Confirmation of this skill change is not approval of a future production plan. Read-only discovery and inspection can proceed before approval; reference/Layout generation needs user authorization for the proposed step. Show and inspect newly generated references, then obtain confirmation of the final actual reference list before production video generation. For an explicitly authorized standalone workflow test, use that test's existing authorization and requested inputs without introducing a managed production proposal.

After an approved card's workflow has a wiring-only repair, reuse the approved card and its version. Do not show a replacement card merely to repair missing nodes, output indices or socket types when the approved shot content, duration, references, dimensions, workflow path and continuity route/source remain the same. If a creative or card field changes, show the revised card and wait for confirmation.

Record the approved card_id, clip_id, proposal version and approving user message. A changed actor, action, dialogue, duration, framing, scene, reference file/order/responsibility, or continuity plan invalidates the affected approval: show the revision and wait again. A technical retry that changes none of these may follow the approved scope after repairing the identified failure. A filename alias with verified identical bytes is not a new visual reference. Do not silently substitute a missing reference or queue an unapproved clip. After compaction, recover the stored card and review_status; ask again only if the durable record does not establish confirmation.

## Generation order

Choose submission order from the user's request and technical dependencies. Generate a required source clip first and verify its actual video/latent files before preparing the dependent clip. An approved sequence may continue once those dependencies are ready; it does not require automatic visual acceptance of each clip. If an unknown actual pose, screen direction, prop state or composition would materially change the next shot, ask the user to resolve that specific uncertainty. Inspect only the small amount of evidence needed to answer that question when useful.

For an independent set explicitly requested for unattended generation, multiple jobs may be submitted together. Otherwise keep clip generation sequential enough to preserve continuity.

For managed production, use `h3-prompt-writing` after the user has confirmed the actual shot plan and reference list. Report verified generation completion separately from user acceptance. Continuation alone does not request visual QC; perform output assessment when the user explicitly asks for review or diagnosis.

## Workflow evidence on dependent H3 cards

`director_workflows` `list` also returns `recent_inspections`: paths inspected earlier in this session, including before any submission. Reinspect the selected graph after editing it. If any H3 clip depends on previous context, put `clip_workflows: [{clip_id, workflow_path, continuity_mode, continuity_source}]` on the final card with one entry for every clip; independent clips use `continuity_mode: "none"` and omit the source. Use the absolute inspected API template path and the inspector's actual route and source. The card must display this evidence; a prose claim of "saved latent" does not establish the graph route. A changed continuity route or source needs a revised card and fresh confirmation. A technical execution-copy path alone does not.

Set `continuity_requirement` to `sampler_latent` or `video_frames`, matching the inspected route, for both validation and submission of every dependent H3 clip. `unverified_latent` is a trace of custom wiring, not proof of saved sampler latent; inspect installed node schemas and source provenance before submission. The submit gate compares the approved path, route and source with the actual graph. A previous-video multi-frame route does not require a saved sampler latent unless the user explicitly requires one.

For previous-video context, use the exact selected output filename, including its numbered suffix and extension, rather than SaveVideo.filename_prefix. Stage or copy video with Harness native coding tools and the installed video loader interface; `director_stage_images` accepts images only. Preserve approved identity/costume references when changing the context route. Inspect the exact current clip graph: `continuity.wiring` must show previous context input and conditioning reaching the guider/sampler, plus the trim/output path. A disconnected MotionContext node does not establish continuation, and a similarly named graph from another project does not establish how this clip was generated.

For a proposed sampler-latent chain, query the installed SaveLatent and LoadLatent schemas and read their `required_details` tooltips before assigning `clip_index`; the integer type alone does not describe first-clip behavior. Verify the source output type is LATENT and the current sampler output is saved. After preparing each API graph, compare `director_workflows inspect` `generation_timing.delivered_frames/fps` with the sum of its card shot durations to within one frame. The offline `h3-timing.mjs` helper covers fresh clips only; it does not account for context trimming.

For this installed Motion Context loader, `latent_path` points to the ComfyUI output **directory** containing numbered slots, or to the exact `.safetensors` file. Do not copy `SaveLatent.filename_prefix` into `LoadLatent.latent_path`: a prefix such as `chain/C1_latent` is not itself a file or directory. When the prior clip has not run, describe the slot as pending and do not claim the loader has succeeded merely because `inspect` reports its wiring. For each clip preflight, put only that clip's scripted lines in `h3_review.dialogue`; each must have one matching `<d>[Language] words</d>` block and the named speaker outside the block in `detailed_description`.

The `submit_comfy_job` gate checks the installed Motion Context slot before it queues a dependent sampler-latent clip. In `validate_only`, an absent prior slot is a `submission_blocker`; generate the prior clip and verify its saved latent file before retrying. A completed static graph check alone cannot prove the prior latent exists.

## Deliver results; review when requested

When a generation finishes:

1. Locate the actual output for the completed job. Verify the file exists, is nonempty and readable as video; check its stream metadata, dimensions, frame rate, delivered duration and requested audio. If a later clip needs saved sampler latent, verify that exact file, take provenance and interface compatibility. These are technical checks and require no routine frame extraction or visual grading.
2. Show the finished MP4/WebM in the conversation with `director_show_media` using a video item and no new shot proposal. Check that its returned item is `type: "video"` with a `/director-media/` URL. A file path or `present` call alone does not establish a playable Web/mobile media card.
3. Report the actual output, verified technical results and any unresolved technical issue. Production quality and final acceptance belong to the user; do not claim that a generated clip passed visual review merely because its job completed.
4. Continue only the remaining work already authorized by the user. In an approved multi-clip sequence, ready video/latent dependencies permit the next clip without an additional agent visual-acceptance gate. Otherwise end with the displayed result for the user's review.

Do not run default post-generation contact sheets, frame-by-frame analysis, automatic aesthetic corrections or corrective regeneration. A technically completed clip can be delivered successfully while its production quality awaits the user's review. Regenerate for a creative correction when the user requests it, within the applicable approved scope.

If the user explicitly asks for visual review or defect diagnosis, assess the requested issue and only the relevant moments or frames. Compare actual source references when making claims about identity, wardrobe, props or scene retention. Keep `reported_output_defect`, `source_observation` and `cause_hypothesis` distinct; an old summary or prompt is not current pixel evidence. State which evidence was inspected and what remains uncertain, and recommend a targeted change when supported. Do not silently turn that assessment into a new generation job. For a material continuity uncertainty, ask the user; a small targeted evidence check may answer the question without creating a default per-clip review process.
