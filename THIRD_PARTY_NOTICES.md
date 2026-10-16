# Third-party notices

Analytics Dashboard's source uses the MIT license in [LICENSE](LICENSE), as already declared in the application's Terms. Libraries, model weights and runtime binaries retain their own licenses.

The production build generates `third-party-notices.txt` from installed production dependency license/copyright files and locked metadata, complete license sections embedded in published READMEs, bundled Victory dependency notices, and verified files in `frontend/notices/upstream`. The upstream review records exact source commits, provenance URLs and SHA-256 checksums; generation rejects changed notice files. The generated file ships beside the application.

The October 6 strict gate passes for the emitted browser distribution. `guid-typescript@1.0.9` (declared ISC) remains installed by ONNX but is absent from the shipped WebGPU/WASM entry points. The build records main and worker module graphs, exact reviewed ONNX entry hashes, emitted JavaScript/WASM hashes and known bundled GUID markers. The gate verifies this evidence against current files and rejects changed/unreviewed runtime entries, new artifacts, GUID modules or known implementation markers. It makes an installed-only exception, without inventing upstream copyright/permission text. Shipping `node_modules` or ONNX WebGL/all bundles requires exact licensor evidence or a dependency replacement and a new review. The maintainer command `node scripts/review-upstream-notices.mjs` still exits nonzero when that upstream text is unavailable. This artifact check is not a general proof of absence or legal certification.

Native/runtime/model binary distributions can carry additional terms and notices. This traceable inventory is not legal certification or a completed redistribution audit.

Optional downloaded models are separate assets:

- MiniLM: [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), Apache-2.0.
- Qwen: [Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct), Apache-2.0; [MLC conversion](https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC).
- WebLLM: [upstream license](https://github.com/mlc-ai/web-llm/blob/main/LICENSE), Apache-2.0.
- Transformers.js: [upstream license](https://github.com/huggingface/transformers.js/blob/main/LICENSE), Apache-2.0.
- ONNX Runtime: [upstream license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE), MIT; upstream binary distributions may include additional notices.

Downloaded models are not included in the Git repository or the application build. Keep applicable notices with any separately redistributed model or modified runtime assets.

Runtime downloads are pinned in `frontend/src/utils/localAI/models.js` to these public repository revisions resolved October 6, 2026:

- MiniLM: `751bff37182d3f1213fa05d7196b954e230abad9`.
- MLC Qwen conversion: `8e6ec5f417c7d0e1414703ef619b8a24686e3ab0`.
- MLC binary library: `025bcaf3780fa8254f5e5efd3bfea0a5397248f4`, exact `web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm` path.

Transformers discovery/progress and loading use the pinned revision; WebLLM's sole model record overrides mutable catalogue URLs with pinned paths. The worker rejects mutable `main` URLs, other model repositories, arbitrary query data, request bodies and inference POSTs. These pins establish requested repository identity, not independent digest verification of every remote weight or a completed conversion/binary redistribution audit.
