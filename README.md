# dsh-director

An unofficial Director plugin for DeepSeek Harness Web. Turn a rough idea into a
reviewed shot plan, bind visual references, submit local ComfyUI jobs, and review
images, videos and generated audio inside the conversation. **No Director Studio dependency.**

Version 0.1.76. Original implementation and local skill wrappers use MIT. Official MiniMax prompt
guides are not included; users can obtain pinned copies separately under upstream
terms after native human confirmation. See [LICENSE](LICENSE),
[third-party notices](THIRD_PARTY_NOTICES.md), and the
[release-review checklist](docs/RELEASE_REVIEW.md) before public redistribution.

## Quick start

1. Install Node.js >=22 and a compatible [DeepSeek Harness Web](https://github.com/deepseek-ai/deepseek-harness).
   Set up your local vision-capable model server and ComfyUI separately.
2. Build the plugin package from this repository:

   ```sh
   git clone https://github.com/ai2764/dsh-director.git
   cd dsh-director
   npm ci
   npm pack
   ```

   On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`.
   `npm pack` builds the plugin and produces `dsh-director-0.1.76.tgz`.
3. In Harness Web, open **Plugins → Add plugin**, enter the absolute path to that
   `.tgz`, click **Install**, then **Enable now**. Restart Harness if prompted and
   refresh the browser. Keep your existing profile and launch settings.
4. In **Settings → Models**, configure your provider's API address and exact model
   ID. For the llama-swap example, use `http://127.0.0.1:11435/v1`. In the model's
   options, enable **Text** and **Image**, and use limits supported by your server.
   Both the model and its server must actually support image input.
5. Select the model and a project folder, upload your references, and ask the
   agent to load `director` and use an existing local ComfyUI workflow. For H3,
   also load `h3-prompt-writing`; its optional official-guide setup asks separately.

**Using different ports, another machine, WSL or a container?** Follow
[Connections and changing ports](docs/CONFIGURATION.md). The Harness browser port,
model API address, ComfyUI address and llama-swap control address are separate
settings. Changing one does not change the others.

## Scope

- **Director skill:** story beats, shots versus clips, pacing, reference casting,
  exact dialogue and continuity handoffs. Creative decisions remain with the agent.
- **Optional H3 guidance:** a local Ref2AV wrapper, image-inspection requirements
  and six-section prompt checks; complete official guides are downloaded separately.
- **Review UI:** distinguishable shot/reference cards, incremental reference edits,
  versioned human confirmation, inline media and enlarged previews.
- **Managed submission:** preflight, actual reference-byte/order checks, ComfyUI
  monitoring, llama-swap unload, turn conclusion and verified GPU handoff.
- **Asset reuse:** recover session upload paths, register selected local/generated
  images and stage selected references with byte-verified bindings.
- **Web integration:** dedicated Director media/review views alongside Harness's
  native coding tool views, connection status and draft-preserving send protection
  during known GPU generation or handoff.

**No workflow, model weights, custom nodes, user assets, generated clips or session
exports are bundled.** Harness's native coding tools discover/adapt the user's
local ComfyUI workflows. The plugin does not scan drives or install dependencies
automatically. A selected workflow's nodes, model files and capabilities must exist
locally; requesting an unsupported generation mode does not make it available.

The plugin does not guard Harness's native shell tools or intercept direct ComfyUI
API calls. For standalone workflow debugging or generation tests, the agent can
use those native tools. The managed tools require review binding for H3 Ref2AV;
standalone generic workflows can use them without a Director proposal. Native
file diffs, search, questions and other coding tool views retain Harness's renderer.

The old `h3_ref2av` preset-builder argument was removed in 0.1.28. Use `workflow`
or `workflow_path`. The `intent: "h3_ref2av"` value remains a validation selector,
not a workflow builder. Graphs containing `MiniMaxH3ReferenceToVideo` are also
detected and checked with generic intent.

## Requirements and compatibility

- Node.js >=22.
- A compatible DeepSeek Harness **Web** installation. The compatibility targets are
  `0.1.5-rc.2` and `0.2.0-rc.2`; other releases and Electron are not verified.
- Local ComfyUI with the workflows, nodes and models needed for the requested task.
- llama-swap for managed LLM unload/handoff.

This plugin extends the native Web tool renderer and composer through Harness
extension APIs. Compatibility with a different Harness version needs testing.
It does not modify global Harness files or install a standalone application.

## Command-line installation alternative

For a permitted local installation:

```powershell
npm.cmd ci
npm.cmd pack
dsh.cmd plugin --profile web add C:/path/to/dsh-director-0.1.76.tgz
```

`prepack` builds the runtime automatically. In the Web profile's `package.json`,
include `dsh-director` in `dsh.profile.bundles`, preserving existing bundles.
The included `cordis.patch.yml` enables the plugin entry.

Before changing a profile, back up its package, patch and lockfile. Disable an
older local submit-plugin entry if it owns the same tool names; keep its files for
rollback. Restart Harness when no active turn needs preserving, retaining its
existing bind/trusted-host settings. Refresh the browser after installation.

## Start a production

Upload selected references through Harness, or point the agent at a local image
folder. Ask it to load `director` and `h3-prompt-writing` for H3 work.
Workspace skills with the same names take priority; the plugin never overwrites
them. Folder names and indexes aid selection but do not replace pixel inspection.

A typical conversation:

> Make a short workplace comedy from these character references. Plan the shots
> and reference list first. Use my existing local ComfyUI H3 workflow.

The agent first inspects workflow capability, dimensions, delivered duration and
the actual reference images, then shows a shot/reference card. Confirm the specific
card using its confirmation button or an explicit reply, or request changes. Only
after confirmation should it write the complete production prompt and adapt the
graph for submission. Workflow inspection does not require a finished prompt.

Managed H3 Ref2AV validation and generation require both the approved `card_id`
and one `clip_id` from that card. References, dimensions, duration, dialogue and
declared continuity must match that same clip. A creative change needs a revised
card and fresh confirmation; a graph repair that preserves the approved plan can
reuse its identity. Express silent shots with `dialogue: ""`; for speech, keep the
exact words, speaker and language on the card.

Use `director_show_media` with only `card_id` to view a saved card again; use
`card_id: "latest"` to recover the current card, `review_status`, and any
`approval_seq` after losing track of it. Replay does not clear approval or make an
old card current. Showing identical plan content again also preserves its identity;
changed content receives a new identity and a unique version label. Reading legacy
nested tool results and Harness 0.2 direct tool messages uses the recorded Director
call, so a card-shaped shell result does not become an approval record.

After generation, verify the actual output files and technical metadata, then
display the media for the user. Visual and creative review belongs to the user
unless they explicitly request agent review; automatic frame-by-frame QC and
corrective rerenders are not part of the default flow. An already-authorized
clip chain can continue after its saved context and technical inputs are verified.
Ask when a missing source or an ambiguous creative decision affects that chain.
Structural checks cannot guarantee likeness, continuity, dialogue delivery or comedy.

Reuse a suitable workflow already established in the current context or clip
record. Read that selected graph and check the inputs affected by the new clip;
do not rediscover the full workflow library on every continuation. If the graph
is missing or unsuitable, use Harness's native coding tools to find and adapt a
replacement, with `director_workflows` as an optional discovery/interface helper.
Ask the user when materially different candidates or an uncertain prior take
cannot be resolved from the available evidence.

### Optional official H3 Skill setup

Loading the plugin, listing skills, reading the local wrapper and using other
workflows never download the official H3 files. On first H3 use, the bundled
wrapper reports missing guides and asks the agent to call `director_h3_skill`
with `action: "install"`. Harness shows its native human-question panel with
the fixed upstream revision, source, license link and local cache destination.
Only selecting **Download under upstream terms** authorizes this tool's download;
an agent-supplied boolean or ordinary generated text cannot replace that answer.
This is not a determination of the user's legal eligibility under those terms.

The plugin retrieves only three official prompt documents and the corresponding
pinned license text, checking exact byte lengths and SHA256. It refuses redirects,
oversized responses, partial/corrupt caches and changed upstream bytes. A changed
pin requires a plugin update and new confirmation; there is no silent latest-version
upgrade. Downloading does not execute scripts, install dependencies or fetch models.

Reload `h3-prompt-writing` after installation: its reference-file base then points
to the verified private cache. Subsequent use and restarts work offline with no
repeat confirmation. Existing workspace/user skills retain their native priority
and are never modified. If those skills already supply H3 guidance, this setup
path need not be used. If the human-question capability is unavailable, only the
optional setup tool is absent; the core plugin still loads and reports the limitation.
Damaged caches fail closed; preserve/move aside the indicated dedicated cache
before an explicitly authorized reinstall rather than overwriting user files.

## Core tools

| Tool | Purpose |
| --- | --- |
| `director_assets` | Recover uploads and register selected local image sources |
| `director_stage_images` | Stage 1–9 selected references and return verified ComfyUI filenames |
| `director_workflows` | List saved ComfyUI workflows, inspect a graph, and read installed node sockets |
| `director_show_media` | Display shot/reference review cards and local media; replay a saved card with `card_id` or recover `latest` |
| `director_edit_review` | Update the latest card without regenerating an entire proposal |
| `submit_comfy_job` | Validate and submit one prepared local workflow as a managed job |
| `submit_comfy_video` | Compatibility alias of `submit_comfy_job` |
| `director_h3_skill` | Optional guide status/download setup through native human confirmation |

Supply exactly one of `workflow` (inline ComfyUI API graph) or `workflow_path`.
Large graphs should use a file. The plugin preserves the caller's model, sampler,
dimensions, reference wiring, latent context and output settings. It does not pick
or build a preset on the caller's behalf.

For an existing H3 graph, `h3_prompt` or `h3_prompt_path` can replace only its
prompt in the submitted copy, using exactly six non-empty section strings:
`subject_definitions`, `summary`, `retention_analysis`,
`detailed_description`, `overall_soundscape`, `non_diegetic_music`.
The source workflow file is not rewritten.
The review card records the inspected template path. A compiled execution copy
may use another path without another creative approval; `review_binding` reports
both paths. The selected clip's references, dimensions, duration, dialogue and
continuity route/source must still match. Paths alone are not graph fingerprints.
Validation and submission report `h3_effective_prompt` (source, SHA256 and
summary) from the actual submitted copy. Diagnose a completed job from that
record or ComfyUI history for its prompt ID, not from an unchanged template.

After card approval, use `validate_only: true` and check `submission_ready`,
`submission_blockers` and `issues`. A managed result with `status: "blocked"` has
not queued a generation; it describes a prerequisite or a rejected workflow.
`retry_identical: false` means repair the named cause or wait for confirmation
before retrying. Redisplay the existing card to recover its identity; do not
rebuild an unchanged proposal to clear a submission error. Transport failures and
unknown acceptance outcomes still surface as execution errors and require checking
whether ComfyUI accepted the job before another submission.

For graphs containing MotionContext or VHS_LoadVideo, preflight reads the
installed interfaces and checks proven output dependencies for cycles, required
MotionContext/VHS inputs, and relative VHS video availability. Disconnected
scratch nodes do not block a valid output. VHS paths default to the input
directory; an existing output uses its relative path plus ` [output]`.
`director_workflows schema` documents this interface and API-based staging.
`workflow_preflight.complete: false` and its rendered warnings identify missing
interface or file evidence. Unknown/dynamic interfaces and arbitrary server paths
remain available to the coding agent. Even clear checks are partial: ComfyUI
custom validators, video decoding and generation can still fail.

Real H3 Ref2AV submission verifies current image evidence, reference bytes/order
and confirmation of the selected card and clip. These checks do
not enforce workflows submitted outside the plugin and do not certify visual
quality. Flat API sockets such as `ref_images.ref_image_0` must be real links;
nested reference dictionaries are rejected.

For a known workflow, reuse and inspect its recorded path. When discovery is
needed, call `director_workflows` with `action: "list"`, which also returns recent
inspected and submitted workflow paths from the current session, then use
`action: "inspect"` with the relevant path or saved `workflow_name`. A UI canvas workflow
must be exported or adapted to API format before submission. For a local API
JSON, inspect its `workflow_path`; `action: "schema"` reads one installed node
type's sockets. Inspection reports exact context input and consumer edges in
`continuity.wiring`, sampler-latent save/load slots in `continuity.latent_slots`,
and delivered frame timing. For known H3 graphs, `wiring_verified` and
`wiring_issues` trace the context conditioning through the actual output sampler
and synchronized trim to saved video. Unused context nodes do not make an
independent output a continuation; a latent saved from another sampler branch
does not count as the current video's saved context. Schema responses preserve installed node tooltips,
defaults and output names under `required_details` and `optional_details`.
Harness's native coding tools can locate and adapt project
graphs. For dependent H3 clips, put the inspected absolute API workflow
path, route and source in the review card's `clip_workflows` list. The list
covers every clip, with independent clips marked `none`. Pass
`continuity_requirement` matching the inspected route to validation and submission:
`sampler_latent` for saved sampler output (preferred when compatible and available),
or `video_frames` for consecutive frames from the accepted previous video through
Motion Context. Both routes are supported. Single-tail-frame Pictures and guide
anchors are no longer recommended for continuation. An explicit original-latent
requirement still needs the real saved sampler output; report missing latent and
obtain authorization before rerendering the prior clip. Independent I2V/FLF
workflows remain available.
The submit gate compares the actual graph with the approved card. Custom latent
sockets that the built-in classifier cannot verify remain `unverified_latent`;
reading their schema alone does not make them a recognized sampler-latent route.

The offline `node lib/h3-timing.mjs --shots 5.5,3` helper computes fresh-H3
24-fps shot boundaries and `17k+5` frame alignment. It does not choose creative
durations, modify graphs or calculate latent-context overlaps.

## Configuration and private state

For copyable port-change examples, profile-file locations, model settings and
connection checks, see [the configuration guide](docs/CONFIGURATION.md).

Optional values in the `config` of the `dsh-director` profile entry:

```yaml
comfyBaseUrl: http://127.0.0.1:8188
llamaSwapBaseUrl: http://127.0.0.1:11435
mediaRoot: C:/path/to/private/director-media
skillCacheRoot: C:/path/to/private/director-skills
```

Service addresses must be HTTP(S) origins without embedded credentials, paths or
queries. This package contains no local profile, model aliases or machine paths.

The default private cache is `DSH_HOME/director-media`, or the user's
`.dsh/director-media`. It stores session-scoped catalog metadata and media
snapshots outside the package. The plugin records mappings to native Harness
uploads; it does not relocate the upload store. No automatic cache deletion is
implemented; removing a cache invalidates its old previews.

Registered media plays from its saved snapshot, so moving, deleting or overwriting
the original file does not invalidate historical playback. Snapshots still require
the registered session and the normal Host/Origin/cookie checks. Snapshot integrity
is rechecked after a file identity or modification/change timestamp differs;
unchanged range and HEAD requests reuse a successful integrity check. Production
reference reuse and card revisions separately verify the actual source bytes;
an intact preview does not authorize a changed or missing source for generation.
If an old proposal's fields are invalid but its media metadata is safe, the UI
retains those media items and warns that the proposal cannot be confirmed.

Optional H3 documents and a version-specific consent receipt live under
`DSH_HOME/director-skills` (or the user's `.dsh/director-skills`), configurable
with `skillCacheRoot`. They never enter the source tree, installed plugin directory
or npm package. Missing downloads do not block generic workflow submission.

Media delivery reuses Harness Host/Origin and enabled cookie authentication.
This is a trusted single-user integration, not multi-user session isolation.
A tokenless LAN deployment exposes registered media to users able to operate
that Harness. See [SECURITY.md](SECURITY.md); never expose unauthenticated services
directly to the Internet.

## Jobs, GPU handoff and limitations

An accepted managed submission posts the selected graph, unloads llama-swap and
concludes the current turn. Completion monitoring waits for an idle ComfyUI queue
and verified memory release before waking the agent. `waiting_for_vram` means
execution has ended but handoff is pending; inspect saved job output, **do not
resubmit**. Cancelling a waiting monitor is not proof of GPU release.

The browser keeps drafts editable while unsafe sending is paused. It does not
automatically send a saved draft when generation ends. A service outage alone
does not block ordinary chat when no managed handoff or previous GPU risk is
known. Known generation or unverified release still pauses sending, including
when a subsequent status request fails. This is not a global GPU
scheduler: direct API calls, other applications and unrelated automatic job wakes
can still load models. Standard ComfyUI has no atomic idle-and-free operation.
Monitoring is process-local and is lost on a Harness restart; generated output
remains in ComfyUI. No jobs are queued by merely loading this plugin.

Director cards reveal completed review/media groups while preserving deliberate
manual collapse. Native tool rendering and card presentation do not change model
context consumption. Video previews preserve natural aspect ratio; they do not
repair black bars encoded in a file.
A workflow-valid result still needs human review of the actual output.

## Development and tests

```powershell
npm.cmd ci
# If needed, point at the directory containing the installed Harness package.json:
$env:DSH_TEST_ROOT = 'C:/path/to/node_modules/@deepseek-ai/dsh'
npm.cmd pack
npm.cmd test
npm.cmd pack --dry-run
```

Pack before tests: the suite verifies the actual versioned archive. Windows defaults
to the global npm Harness installation under APPDATA; other platforms need an
explicit `DSH_TEST_ROOT`. Cross-platform runtime behavior is not certified.
Tests use synthetic fixtures and mocked inference services; no GPU/model run is
required. Source, tests and bundled skills live in `src/`, `test/`, `skills/`.
Generated `lib/`, dependencies, archives, local workflows and production data are
excluded from Git. The npm package uses its own explicit runtime file allowlist.

For rollback, restore the backed-up profile package/patch/lockfile and reconcile
its dependencies. Do not delete user skills, ComfyUI data or media originals.
