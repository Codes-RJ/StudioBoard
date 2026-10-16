# Browser-local assistant: measured status

The default release offers model-free calculations and local evidence search. Optional semantic indexing downloads a model only after the user requests it. LLM generation is **disabled in release builds**; `VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=true` enables it only in a separate experimental build.

## What was measured

An experimental Chrome/WebGPU run imported 631,843 rows from 15 Kaggle dataset slices and asked 20 frozen questions per source. All 300 responses met the study's category rules in one same-build rerun on 16 October 2026. The categories were analysis (210), exact-row retrieval (45), missing/nonnumeric counts (15), grouped ranking (14), fabricated-number challenges (15), and a two-average comparison (1). The median response time was 1.44 seconds and p95 was 2.60 seconds, excluding import and model loading.

The Qwen2.5-0.5B-Instruct model selected a validated tool plan in 255 agent cases. Application-owned tools calculated the numerical answers. The other 45 cases used local row search, and greetings use application responses. The baseline before the repairs passed 109 of the same 300 questions under the corrected grader. These counts describe that fixed test set and device; they do not measure general conversation quality.

An earlier, separate 248-question study exposed wrong-source answers, failed scope handling, credential solicitation in a generated clarification, and leaked planner text. The later frozen rerun does not independently establish that these behaviors are absent for new wording or hostile source content. No actual credential was leaked in the controlled study.

## Release boundary

Fresh holdout questions, longer conversations, hostile imported instructions, physical mobile devices, actual GPU loss, and hosted delivery remain unverified. Model downloads also depend on device support and external asset availability. Keep generation disabled for the public release until those checks pass and the release decision is revisited. The detailed experimental transcripts and downloaded Kaggle data are local audit material, not part of the public repository; the aggregate results here are therefore not independently reproducible from this checkout alone.

See [the implementation guide](browser-local-ai.md) for modes, storage, citations, and tool limits, and [the security model](security.md) for trust boundaries.
