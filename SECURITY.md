# Security and private data

This is a trusted, single-user local integration. It is not a multi-user access
control layer or a sandbox for untrusted workflows. Do not expose an unauthenticated
Harness, ComfyUI or llama-swap directly to the Internet. Keep existing Harness
Host/Origin checks and authentication enabled where available.

Session uploads, prompts, media snapshots, generated files, model weights,
profile configurations and voice samples must remain outside this source tree.
The default private cache is under `DSH_HOME/director-media` (or the user's
`.dsh/director-media`), not this package. A tokenless LAN Harness makes registered
media available to users able to operate that Harness.

`.gitignore` is a safety net, not a secret scanner. It cannot prevent secrets in
source files or a forced Git add. Check both the staged diff and `npm pack --dry-run`
before every release; npm's `files` list, not Git ignore rules alone, controls the
package contents. Never post real profiles, session exports or upload manifests
in bug reports. Use synthetic fixtures and redact credentials and private paths.

No public private-reporting channel has been designated yet. Before opening the
repository, configure a private vulnerability-reporting channel. Do not disclose
credentials in a public issue; revoke leaked credentials before removing them
from files or Git history.
