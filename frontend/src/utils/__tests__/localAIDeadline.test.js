import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ASSISTANT_DEADLINE_MS, withAssistantDeadline } from '../localAI/deadline';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('cancels the entire question on deadline and reports a visible timeout', async () => {
  let ownedSignal;
  const pending = withAssistantDeadline((signal) => { ownedSignal = signal; return new Promise(() => {}); });
  const rejected = expect(pending).rejects.toThrow('75-second question limit');
  await vi.advanceTimersByTimeAsync(ASSISTANT_DEADLINE_MS); await rejected;
  expect(ownedSignal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('preserves explicit cancellation and never starts already cancelled work', async () => {
  const controller = new AbortController(); controller.abort(); const task = vi.fn();
  await expect(withAssistantDeadline(task, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('cancels active work even when its promise ignores the abort signal', async () => {
  const controller = new AbortController(); let ownedSignal; let resolveLate;
  const pending = withAssistantDeadline((signal) => { ownedSignal = signal; return new Promise((resolve) => { resolveLate = resolve; }); }, controller.signal);
  await Promise.resolve(); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
  resolveLate('late answer'); await Promise.resolve();
  expect(ownedSignal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('cleans timers on normal completion and propagates native failures', async () => {
  await expect(withAssistantDeadline(async () => 'verified answer')).resolves.toBe('verified answer');
  expect(vi.getTimerCount()).toBe(0);
  await expect(withAssistantDeadline(() => { throw new Error('Native failure'); })).rejects.toThrow('Native failure');
  expect(vi.getTimerCount()).toBe(0);
});
it('observes a late native rejection after timeout without retrying work', async () => {
  let rejectLate; const task = vi.fn(() => new Promise((_, reject) => { rejectLate = reject; }));
  const pending = withAssistantDeadline(task); const rejected = expect(pending).rejects.toThrow('question limit');
  await vi.advanceTimersByTimeAsync(ASSISTANT_DEADLINE_MS); await rejected;
  rejectLate(new Error('Late GPU failure')); await Promise.resolve();
  expect(task).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
