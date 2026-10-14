# Test fixtures

These tests construct synthetic image bytes, workflow fragments, message events
and shot cards in code. They contain no production photographs, clips, voice
samples, upload manifests or session exports. Actor names and longer regression
utterances are generic sample data, not preserved production dialogue.

Fixtures exercise the real plugin boundaries with mocked inference services;
tests do not submit jobs to a running ComfyUI or load a model. Integration fixtures
use the installed Harness libraries selected by `DSH_TEST_ROOT`. The npm archive
does not include this test directory.
