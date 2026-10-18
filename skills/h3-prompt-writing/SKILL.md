---
name: h3-prompt-writing
description: Use when writing or reviewing MiniMax H3 Reference-to-Audiovisual prompts from Picture references, with optional Audio references, especially when identity, wardrobe, props, set geography, composition, or continuity must be preserved.
---

# H3 Ref2AV Prompt Writing

Use the complete official MiniMax H3 Ref2AV guide, not a locally simplified schema. This skill selects Ref2AV only; other modes in the upstream shared guide do not change that choice.

## Required sequence

1. Inspect every actual reference with Harness native `read_image`. Receive image-bearing results before writing. A filename, metadata or another agent's description is not visual evidence. Re-read if compaction removes the images; report image-route failures instead of guessing.
2. Record actual connection order and pixel-grounded responsibilities: `{picture_index, image, source_path, observation, responsibility}`. Distinguish identity, wardrobe and layout. Resolve conflicting references; do not attach every available image automatically.
3. Read [the complete official Ref2AV guide](references/ref-en.txt) in full. Read [the official shared guide](references/base-en.txt) for camera, sound and dialogue conventions. [Provenance](references/UPSTREAM.md) identifies the pinned upstream revision.
4. Follow the official six-section JSON contract, `<Subject N>` definitions, Picture provenance, retention relationship markers, task prefix and `[Shot N]` formatting. A Picture that only sources a Subject does **not** need a separate definition or a repeated Picture tag in retention. Retain the defined Subject; its definition links the source Pictures. Do not replace these rules with free-form local prose.
5. Check the result against the approved shot, duration, reference list and exact dialogue. Use the director skill for shot/ref approval before generation.

## Local reference safeguards

All connected Pictures condition the whole clip; their order is connection order, not a schedule. Do not claim a Picture is an exact first/last frame unless the selected workflow actually supplies that constraint. Use only submitted `<Picture N>` / `<Audio N>` tags.

Separate observed pixels from authored direction. Do not invent moles, eye color, exact anatomy, off-frame clothes, props or geography. Broaden ambiguous details. A face sheet controls identity; a wardrobe sheet controls the visible outfit; a layout controls observed framing, blocking and scene geometry. New actions or settings are authored direction, not facts learned from a reference.

## Submission

Use native coding tools to discover local capabilities and construct workflows; this skill does not impose a machine architecture or require Director Studio.

Require real flat ComfyUI sockets `ref_images.ref_image_0...N` on `MiniMaxH3ReferenceToVideo`, each connected to a distinct loaded image. Nested reference dictionaries can silently lose conditioning.

Pass the inspected manifest in `h3_review.references`, and exact script lines in `h3_review.dialogue` as `{speaker, language, text}` (or `[]` for silence). Use the prompt's actual speaker label, e.g. `<Subject 1> (S1)`. Spoken words occur once in detailed_description as `<d>[Language] exact words</d>`.

Run `submit_comfy_job` with `validate_only: true` before the approved actual submission. Never bypass failed checks with a manual POST. Native image evidence, staged-byte equality and syntax checks establish the submission contract, not semantic understanding or identity fidelity. After generation, verify the actual output file and technical metadata, then show the video for the user to review. Do not perform automatic visual QC or corrective rerenders unless the user requests them. Report generation completion separately from any unverified claim about visual fidelity.
