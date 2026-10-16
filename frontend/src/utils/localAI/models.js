// Fixed asset identities, never derived from uploaded data or model output.
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const LLM_MODEL = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
// Public repository revisions resolved on 2026-10-06. Changing these requires
// new load/cache/quality and license reviews; downloads never follow main.
export const EMBEDDING_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
export const LLM_REVISION = '8e6ec5f417c7d0e1414703ef619b8a24686e3ab0';
export const LLM_ASSET_BASE = `https://huggingface.co/mlc-ai/${LLM_MODEL}/resolve/${LLM_REVISION}/`;
export const LLM_LIBRARY_URL = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm';
export const MODEL_INFO = {
  embeddings: { label: 'MiniLM semantic search (WASM)', download: 'About 25–35 MB plus runtime files', license: 'Apache-2.0', url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2' },
  llm: { label: 'Qwen 2.5 0.5B (WebGPU)', download: 'Several hundred MB; runtime reports actual progress', memory: 'Runtime catalogue estimates about 1.1 GB GPU memory; device limits vary', license: 'Apache-2.0', url: 'https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC' }
};
