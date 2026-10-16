import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it('blocks model loading and generation before allocating a worker in release builds', async () => {
  vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM', 'false'); vi.resetModules();
  const worker = vi.fn(); vi.stubGlobal('Worker', worker);
  const { loadLocalModel, generateLocalAction } = await import('../localAI/runtime');
  await expect(loadLocalModel('llm')).rejects.toThrow('disabled in this build');
  await expect(generateLocalAction([])).rejects.toThrow('disabled in this build');
  expect(worker).not.toHaveBeenCalled();
});

it('requires an explicit true flag to opt into experimental generation', async () => {
  for (const value of ['', 'false', '1', 'TRUE']) {
    vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM', value); vi.resetModules();
    expect((await import('../localAI/releasePolicy')).requireLocalLLM).toThrow('disabled');
  }
  vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM', 'true'); vi.resetModules();
  expect((await import('../localAI/releasePolicy')).requireLocalLLM).not.toThrow();
});
