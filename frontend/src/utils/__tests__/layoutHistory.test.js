import { describe, expect, it } from 'vitest';
import { createLayoutHistory } from '../layoutHistory';

const layout = (title) => ({
  id: 'layout-1',
  name: 'Layout',
  layout: [{ i: '1', x: 0, y: 0, w: 4, h: 3, title }]
});

describe('layout history', () => {
  it('supports apply, undo, and redo without sharing mutable card objects', () => {
    const original = layout('Original');
    const history = createLayoutHistory(original);
    const changed = layout('Changed');

    expect(history.apply(changed)).toMatchObject({ canUndo: true, canRedo: false });
    changed.layout[0].title = 'Mutated elsewhere';

    expect(history.undo()).toMatchObject({
      canUndo: false,
      canRedo: true,
      present: { layout: [{ title: 'Original' }] }
    });
    expect(history.redo()).toMatchObject({
      canUndo: true,
      canRedo: false,
      present: { layout: [{ title: 'Changed' }] }
    });
  });

  it('clears redo history after a new edit', () => {
    const history = createLayoutHistory(layout('A'));
    history.apply(layout('B'));
    history.undo();
    history.apply(layout('C'));

    expect(history.snapshot()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('bounds retained undo entries', () => {
    const history = createLayoutHistory(layout('A'), 2);
    history.apply(layout('B'));
    history.apply(layout('C'));
    history.apply(layout('D'));

    expect(history.undo().present.layout[0].title).toBe('C');
    expect(history.undo().present.layout[0].title).toBe('B');
    expect(history.undo().present.layout[0].title).toBe('B');
  });
});
