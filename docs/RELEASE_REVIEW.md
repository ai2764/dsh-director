# Source release review

Status: source prepared for owner review; **not published**. This document is not
a security certification or legal approval.

## Repository boundary

Only this package is a Git repository. The surrounding Harness workspace is not
part of it. Core contents:

| Directory | Purpose |
| --- | --- |
| `src/` | Server tools, managed ComfyUI handoff, media and review state, Web UI |
| `skills/director/` | Shot planning, reference casting and continuity guidance |
| `skills/h3-prompt-writing/` | Original local H3 wrapper and upstream source pointers only |
| `scripts/` | Build and pure profile-migration planning helper |
| `test/` | Synthetic unit/integration fixtures, no production assets |
| `docs/` | Installation/configuration and release-boundary documentation |

`lib/`, `node_modules/` and old/new `.tgz` archives are local build artifacts,
excluded from Git. The npm archive intentionally contains compiled `lib/`, bundled
skills, plugin metadata, README, configuration/release guides and license notices,
not the source test suite. The package includes only root-level compiled JavaScript from
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

- Review optional-download terms and the Git publication boundary. See `THIRD_PARTY_NOTICES.md`;
  older local commits still retain the previously vendored guide text. Version
  0.1.76's working tree and npm package exclude that text, but this does not erase
  historical Git objects. The `public-release` branch is intended as a source-only
  root snapshot, without private development parents. Publishing that branch to a
  new repository is straightforward; replacing this private repository's default
  branch requires an explicit, reviewed history replacement before making it
  public. Pushing a new branch alongside the old history is not sufficient.
- Confirm ownership/license authority for original implementation and wrappers.
- Select the public author identity, repository URL and private security channel.
- Review the staged/tracked files and the actual npm tarball, not just ignore rules.
- Run a dedicated secret scanner before publishing and on subsequent contributions.
- Document the exact Harness versions that are tested; current targets are Web
  `0.1.5-rc.2` and `0.2.0-rc.2`. Compatibility with other versions is not implied.
- Never include personal profiles, conversations, uploaded identities, voices,
  workflow output, browser storage, recordings or model binaries.

The source remote is `https://github.com/ai2764/dsh-director.git`. Preparing a local
commit or public snapshot does not push, publish an npm package, upload release
assets, change repository visibility, or rewrite the remote's existing history.

## Repeat the release-boundary check

Stage only the intended source, tests, original skills, metadata and documentation.
Review `git diff --cached --stat` and `git diff --cached --check`. With Gitleaks
installed, scan both the staged changes and reachable history:

```sh
gitleaks git --staged --redact .
gitleaks git --log-opts="--all" --redact .
npm pack --dry-run
```

Secret scanning does not identify every personal record or third-party license
restriction. Review the actual file list as well. Test envelope IDs and message
content must be synthetic; no captured session events should enter the release.
Before opening a source snapshot, inspect the history of the exact branch being
published, not just the current tree or `.gitignore`.
