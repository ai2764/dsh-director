# Local release-review candidate

Status: source prepared for owner review; **not published**. This document is not
a security certification or legal approval.

## Repository boundary

Only this package is a Git repository. The surrounding Harness workspace is not
part of it. Core contents:

| Directory | Purpose |
| --- | --- |
| `src/` | Server tools, managed ComfyUI handoff, media and review state, Web UI |
| `skills/director/` | Shot planning, reference casting and continuity guidance |
| `skills/h3-prompt-writing/` | Local H3 wrapper and separately licensed upstream guides |
| `scripts/` | Build and pure profile-migration planning helper |
| `test/` | Synthetic unit/integration fixtures, no production assets |

`lib/`, `node_modules/` and old/new `.tgz` archives are local build artifacts,
excluded from Git. The npm archive intentionally contains compiled `lib/`, bundled
skills, plugin metadata, README and license notices, not the source test suite. The package includes only root-level compiled JavaScript from
`lib/`, so stale local template directories are excluded even after rebuilding.
`.gitignore` blocks unlisted top-level files and common credentials/media/data
patterns even under allowed directories. Never force-add local artifacts.

No workflow template or preset builder is committed or distributed. Harness's
native coding tools discover/adapt the user's local ComfyUI API graph, then pass
`workflow` or `workflow_path` to the generic managed submit tool. Existing local
workflow templates remain untracked and are not deleted. No live Harness profile,
session, generated clip or installed runtime plugin is migrated by this cleanup.

## Reproduce without model/GPU access

With Node.js >=22 and a compatible local Harness installation:

```powershell
npm.cmd ci
# Set this if Harness is not installed at the Windows global-npm default:
$env:DSH_TEST_ROOT = 'C:/path/to/node_modules/@deepseek-ai/dsh'
npm.cmd pack
npm.cmd test
npm.cmd pack --dry-run
```

`prepack` builds `lib/`. Pack before running the full test suite: `pack.test.mjs`
verifies the actual versioned tarball. Tests use synthetic images and mocked
service responses; they do not queue video, load models or require a GPU.
Linux/macOS require an explicit `DSH_TEST_ROOT`; cross-platform runtime/UI behavior
has not been certified. Build/pack alone do not require the separate Harness
installation used by integration tests.

## Owner review before public release

- Resolve MiniMax guide redistribution permission. See `THIRD_PARTY_NOTICES.md`;
  the complete tree must not be described as unrestricted MIT source.
- Confirm ownership/license authority for original implementation and wrappers.
- Select the public author identity, repository URL and private security channel.
- Review the staged/tracked files and the actual npm tarball, not just ignore rules.
- Run a dedicated secret scanner before publishing and on subsequent contributions.
- Document the exact Harness versions that are tested; current target remains
  Web `0.1.5-rc.2`. Compatibility with newer versions is not implied.
- Never include personal profiles, conversations, uploaded identities, voices,
  workflow output, browser storage, recordings or model binaries.

No remote is required for local review. Do not push or publish until these checks
and licensing decisions are complete.
