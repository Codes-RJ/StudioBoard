import { describe, expect, it, vi } from 'vitest';
import { createSerialTaskQueue, resolveServerLayoutId } from '../layoutPersistence';

describe('layout persistence helpers', () => {
  it('runs saves in request order', async () => {
    const enqueue = createSerialTaskQueue();
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueue(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 'first';
    });
    const secondTask = vi.fn(async () => {
      events.push('second');
      return 'second';
    });
    const second = enqueue(secondTask);

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    expect(secondTask).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues after an earlier save fails', async () => {
    const enqueue = createSerialTaskQueue();
    const failed = enqueue(async () => {
      throw new Error('network failure');
    });
    const recovered = enqueue(async () => 'saved');

    await expect(failed).rejects.toThrow('network failure');
    await expect(recovered).resolves.toBe('saved');
  });

  it('uses aliases for newly-created layouts and known IDs for updates', () => {
    const persistedIds = new Set(['server-existing']);
    const aliases = new Map([['local-new', 'server-created']]);

    expect(resolveServerLayoutId('local-new', persistedIds, aliases)).toBe('server-created');
    expect(resolveServerLayoutId('server-existing', persistedIds, aliases)).toBe('server-existing');
    expect(resolveServerLayoutId('layout_generated', persistedIds, aliases)).toBeNull();
  });
});
