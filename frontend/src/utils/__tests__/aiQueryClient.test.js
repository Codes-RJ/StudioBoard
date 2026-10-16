import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances = [];

  constructor() {
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
    const delay = message.operation === 'query' ? 15 : 0;
    setTimeout(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: {
        id: message.id,
        result: message.operation === 'initialize'
          ? { revision: message.dataset.id }
          : { query: message.query, directAnswer: 'done' }
      } });
    }, delay);
  }

  terminate() {
    this.terminated = true;
  }
}

const dataset = (id) => ({
  id,
  updatedAt: id,
  columns: [{ name: 'Revenue', type: 'number' }],
  rawRows: [{ Revenue: 10 }]
});

describe('aiQueryClient worker lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('answers polite conversation without starting a worker, including without a dataset', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    for (const question of ['Hi', 'Hello', 'Thank you', 'Bye']) {
      await expect(askDatasetQuestion(question, null)).resolves.toMatchObject({ intent: 'CONVERSATION' });
    }
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('does not start work for an already cancelled question', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    const controller = new AbortController(); controller.abort();
    await expect(askDatasetQuestion('Total revenue', dataset('one'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('bounds a silent worker and can answer a fresh question afterward', async () => {
    vi.useFakeTimers();
    class SilentWorker extends FakeWorker { postMessage(message) { this.messages.push(message); } }
    vi.stubGlobal('Worker', SilentWorker);
    const { askDatasetQuestion } = await import('../aiQueryClient');
    const pending = askDatasetQuestion('Total revenue', dataset('one'));
    const rejected = expect(pending).rejects.toThrow('75-second question limit');
    await vi.advanceTimersByTimeAsync(75_000);
    await rejected;
    expect(FakeWorker.instances[0].terminated).toBe(true);
    vi.stubGlobal('Worker', FakeWorker);
    const retry = askDatasetQuestion('Total revenue', dataset('one'));
    await vi.runAllTimersAsync();
    await expect(retry).resolves.toMatchObject({ directAnswer: 'done' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects unreadable worker responses and permits a fresh question', async () => {
    class BrokenWorker extends FakeWorker {
      postMessage() { queueMicrotask(() => this.onmessageerror?.()); }
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const { askDatasetQuestion } = await import('../aiQueryClient');
    await expect(askDatasetQuestion('Total revenue', dataset('one'))).rejects.toThrow('unreadable response');
    expect(FakeWorker.instances[0].terminated).toBe(true);
    vi.stubGlobal('Worker', FakeWorker);
    await expect(askDatasetQuestion('Total revenue', dataset('one'))).resolves.toMatchObject({ directAnswer: 'done' });
  });

  it('suppresses duplicate in-flight questions', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    const [first, second] = await Promise.all([
      askDatasetQuestion('Total revenue', dataset('one')),
      askDatasetQuestion('  total   REVENUE ', dataset('one'))
    ]);
    expect(first.directAnswer).toBe('done');
    expect(second.directAnswer).toBe('done');
    expect(FakeWorker.instances[0].messages.filter(({ operation }) => operation === 'query')).toHaveLength(1);
  });

  it('does not share cached work across different dashboard scopes', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    await Promise.all([
      askDatasetQuestion('Total revenue', dataset('one'), { scopeFilters: { Region: 'East' } }),
      askDatasetQuestion('Total revenue', dataset('one'), { scopeFilters: { Region: 'West' } })
    ]);
    const queryMessages = FakeWorker.instances[0].messages.filter(({ operation }) => operation === 'query');
    expect(queryMessages).toHaveLength(2);
    expect(queryMessages.map(({ scopeFilters }) => scopeFilters.Region)).toEqual(['East', 'West']);
  });

  it('includes conversational context in worker requests and duplicate keys', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    const firstContext = { intent: 'RANKING', metrics: ['Revenue'], dimensions: ['Region'], aggregation: 'sum', order: 'desc', limit: 5 };
    const secondContext = { ...firstContext, metrics: ['Cost'] };
    await Promise.all([
      askDatasetQuestion('Now West', dataset('one'), { context: firstContext }),
      askDatasetQuestion('Now West', dataset('one'), { context: secondContext })
    ]);
    const queryMessages = FakeWorker.instances[0].messages.filter(({ operation }) => operation === 'query');
    expect(queryMessages).toHaveLength(2);
    expect(queryMessages.map(({ context }) => context.metrics[0])).toEqual(['Revenue', 'Cost']);
  });

  it('terminates work and rejects with AbortError on cancellation', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    const controller = new AbortController();
    const pending = askDatasetQuestion('Total revenue', dataset('one'), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('does not allow an old dataset result to replace a new one', async () => {
    const { askDatasetQuestion } = await import('../aiQueryClient');
    const oldRequest = askDatasetQuestion('Total revenue', dataset('old'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newRequest = askDatasetQuestion('Total revenue', dataset('new'));
    await expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    await expect(newRequest).resolves.toMatchObject({ directAnswer: 'done' });
    expect(FakeWorker.instances).toHaveLength(2);
  });
});
