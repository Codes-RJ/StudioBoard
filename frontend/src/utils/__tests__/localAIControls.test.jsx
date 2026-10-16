import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ listener: null, state: { llm: true, embeddings: false, loading: false, error: '', progress: '' }, stop: vi.fn() }));
vi.mock('../localAI/runtime', () => ({ getLocalAIState: () => runtime.state, subscribeLocalAI: (callback) => { runtime.listener = callback; return () => {}; },
  loadLocalModel: vi.fn(), stopLocalModels: runtime.stop, clearLocalModelCache: vi.fn() }));
vi.mock('../localAI/releasePolicy', () => ({ experimentalLocalLLM: true }));
import LocalAIControls from '../../components/dashboard/LocalAIControls';
it('retains conversation mode after runtime failure, while explicit stop still switches modes', () => {
  const change = vi.fn();
  render(<LocalAIControls mode="agent" onModeChange={change} busy={false} dataset={{ id: 'fixture', revision: 'r1', columns: [], rawRows: [] }} />);
  act(() => runtime.listener({ ...runtime.state, llm: false, error: 'Device lost' }));
  expect(change).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toBe('Device lost');
  expect(screen.getByLabelText('Assistant mode').value).toBe('agent');
  fireEvent.click(screen.getByRole('button', { name: 'Stop / unload models' }));
  expect(change).toHaveBeenCalledWith('rules'); expect(runtime.stop).toHaveBeenCalledOnce();
});
