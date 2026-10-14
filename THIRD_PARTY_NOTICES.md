# Third-party sources and distribution boundary

## Optional MiniMax H3 prompt documents

The current source tree and npm package do **not** contain the official
`ref-en.txt`, `base-en.txt`, upstream `SKILL.md`, or their license text.
The local `skills/h3-prompt-writing/SKILL.md` is this project's original
Ref2AV integration wrapper, not a relabeled official Skill.

Users may separately obtain three official guide files from
[MiniMax-AI/MiniMax-H3 at revision a107547fa669c509b8e6363fe18378d46ab3066c](https://github.com/MiniMax-AI/MiniMax-H3/tree/a107547fa669c509b8e6363fe18378d46ab3066c/skills/h3-prompt-writing).
The optional setup tool shows the source, revision and associated
[upstream license text](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE)
before asking for native human confirmation. Exact URLs, byte lengths and SHA256
are pinned in `src/skills.mjs`. Downloaded documents and the license text are
stored only in the user's private cache, not in this distribution.

Optional downloaded material retains its upstream terms; this project's MIT
license does not relicense it. Fetching files separately is not a license exemption
or a determination of the user's eligibility. No model weights, custom nodes or
workflow graphs are downloaded by this setup tool.

**History note:** the initial local review commit (0.1.28) retained official
documents. Removing them from the current tree does not erase prior commits.
Public Git-history preparation is a separate owner decision; no history rewrite
or publication has occurred.

## npm dependencies

Dependencies and their registry origins are recorded in `package-lock.json`;
they retain their own licenses. React is external to the browser bundle. Build
output preserves esbuild's legal comments. Harness, ComfyUI, llama-swap and any
models/nodes installed by the user are separate products with their own terms.
