# dsh-director

An unofficial Director plugin for DeepSeek Harness Web. Turn a rough idea into a
reviewed shot plan, bind visual references, submit local ComfyUI jobs, and review
images/videos inside the conversation. **No Director Studio dependency.**

Local source-review candidate, version 0.1.32. Nothing is published automatically.
Original implementation and local skill wrappers use MIT. Official MiniMax prompt
guides are not included; users can obtain pinned copies separately under upstream
terms after native human confirmation. See [LICENSE](LICENSE),
[third-party notices](THIRD_PARTY_NOTICES.md), and the
[release-review checklist](docs/RELEASE_REVIEW.md) before public redistribution.

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
- **Compact Web UI:** connected tool rows, Director markers, automatic detail
  folding, connection status and draft-preserving send protection during generation.

**No workflow, model weights, custom nodes, user assets, generated clips or session
exports are bundled.** Harness's native coding tools discover/adapt the user's
local ComfyUI workflows. The plugin does not scan drives or install dependencies
automatically. A selected workflow's nodes, model files and capabilities must exist
locally; requesting an unsupported generation mode does not make it available.

The old `h3_ref2av` preset-builder argument was removed in 0.1.28. Use `workflow`
or `workflow_path`. The `intent: "h3_ref2av"` value remains a validation selector,
not a workflow builder. H3 graphs are also detected and checked with generic intent.

## Requirements and compatibility

- Node.js >=22.
- A compatible DeepSeek Harness **Web** installation. The compatibility target is
  `0.1.5-rc.2`; other releases and Electron are not verified.
- Local ComfyUI with the workflows, nodes and models needed for the requested task.
- llama-swap for managed LLM unload/handoff.

This plugin extends the native Web tool renderer and composer through Harness
extension APIs. Compatibility with a different Harness version needs testing.
It does not modify global Harness files or install a standalone application.

## Build and install

For a permitted local installation:

```powershell
npm.cmd ci
npm.cmd pack
dsh.cmd plugin --profile web add C:/path/to/dsh-director-0.1.32.tgz
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

The agent plans the story, inspects actual references, and shows a versioned
shot/reference card. Confirm that displayed version or request changes. Editing a
card requires fresh confirmation. Review each generated result before accepting
or continuing; structural checks cannot guarantee likeness, continuity or comedy.

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
| `director_show_media` | Display shot/reference review cards and local image/video results |
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

Use `validate_only: true` first and check `submission_ready` as well as
`submission_blockers`. Real H3 submission verifies current image evidence,
reference bytes/order and applicable native human confirmation. These checks do
not enforce workflows submitted outside the plugin and do not certify visual
quality. Flat API sockets such as `ref_images.ref_image_0` must be real links;
nested reference dictionaries are rejected.

The offline `node lib/h3-timing.mjs --shots 5.5,3` helper computes fresh-H3
24-fps shot boundaries and `17k+5` frame alignment. It does not choose creative
durations, modify graphs or calculate latent-context overlaps.

## Configuration and private state

Optional values on the `dsh-director` plugin entry:

```yaml
comfyBaseUrl: http://127.0.0.1:8188
llamaSwapBaseUrl: http://127.0.0.1:11435
mediaRoot: C:/path/to/private/director-media
skillCacheRoot: C:/path/to/private/director-skills
```

Service addresses must be HTTP(S) origins without embedded credentials, paths or
queries. This package contains no local profile, model aliases or machine paths.

The default private cache is `DSH_HOME/director-media`, or the user's
`.dsh/director-media`. It stores session-isolated catalog metadata and media
snapshots outside the package. The plugin records mappings to native Harness
uploads; it does not relocate the upload store. No automatic cache deletion is
implemented; removing a cache invalidates its old previews.

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
automatically send a saved draft when generation ends. This is not a global GPU
scheduler: direct API calls, other applications and unrelated automatic job wakes
can still load models. Standard ComfyUI has no atomic idle-and-free operation.
Monitoring is process-local and is lost on a Harness restart; generated output
remains in ComfyUI. No jobs are queued by merely loading this plugin.

Compact tool rows change presentation only, not context consumption. Video previews
preserve natural aspect ratio; they do not repair black bars encoded in a file.
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
