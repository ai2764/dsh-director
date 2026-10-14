# Third-party material

## MiniMax H3 prompt documentation

These files retain the complete upstream content, with normalized trailing
newlines, from `MiniMax-AI/MiniMax-H3` revision
`a107547fa669c509b8e6363fe18378d46ab3066c`:

- `skills/h3-prompt-writing/references/ref-en.txt`
- `skills/h3-prompt-writing/references/base-en.txt`
- `skills/h3-prompt-writing/references/upstream-SKILL.md`

[Pinned source](https://github.com/MiniMax-AI/MiniMax-H3/tree/a107547fa669c509b8e6363fe18378d46ab3066c/skills/h3-prompt-writing).
The pinned upstream README points to the
[MiniMax H3 Community License Agreement](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE),
whose text was retrieved on 2026-10-14 and is retained in `LICENSE.minimax-h3`.
That agreement expressly includes documentation; no separate permissive license
for these guide files was found at the pinned revision.

These documents are **not MIT-licensed by this project**. The upstream agreement
contains territorial, redistribution, use and other conditions. This local
repository is a review candidate, not a conclusion that worldwide public
redistribution is permitted. Resolve permission or a different distribution
arrangement with the rights holder before public release. No inference model is
downloaded or bundled by this plugin.

The entrypoint `skills/h3-prompt-writing/SKILL.md` is a local Ref2AV-only wrapper,
not an upstream file. No workflow graphs, inference models or model weights are
bundled; the agent selects separately installed local capabilities.

## npm dependencies

Dependencies and their versions/registry origins are recorded in
`package-lock.json`. They keep their own licenses. React is external to the web
bundle; build output preserves esbuild's legal comments. Installations must
retain the notices supplied with their dependencies. Harness, ComfyUI,
llama-swap and model licenses are separate from this plugin's original MIT code.
