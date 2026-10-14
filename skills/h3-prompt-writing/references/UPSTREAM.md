# Official H3 source — fetched separately

This plugin ships only its own Ref2AV wrapper and these source pointers.
The complete official guides are not bundled.

Pinned source: https://github.com/MiniMax-AI/MiniMax-H3/tree/a107547fa669c509b8e6363fe18378d46ab3066c/skills/h3-prompt-writing

The optional `director_h3_skill` setup tool asks through Harness's native human
confirmation UI before retrieving the upstream `SKILL.md`, `references/ref-en.txt`
and `references/base-en.txt`, together with the associated pinned license text.
The official entrypoint is retained as `references/upstream-SKILL.md`; the local
wrapper remains the plugin's entrypoint. Exact source URLs, byte sizes and SHA256
are recorded in `src/skills.mjs` (or installed `lib/skills.mjs`).

Downloads live in the private configured skill cache. After setup, reload this
skill so its reference base points there. A verified cache is reusable offline.
Existing user/workspace skills are never overwritten. This is not an official
MiniMax plugin; optional retrieved material keeps its upstream terms.
