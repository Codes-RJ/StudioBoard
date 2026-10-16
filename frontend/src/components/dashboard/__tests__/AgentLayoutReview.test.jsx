import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AgentLayoutReview from '../AgentLayoutReview';

describe('reviewable agent layout', () => {
  it('traps keyboard focus, cancels without applying and restores focus to the opener', async () => {
    const onApply = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Preview</button>{open && <AgentLayoutReview
        proposal={{ title: 'Reviewed plan', density: 'compact', cards: [{ i: 'card', title: 'Revenue', chartType: 'bar', aggregation: 'sum', preferredY: 'revenue', evidenceId: 'c1' }] }}
        computations={[{ evidenceId: 'c1', eligibleRows: 3, missingRows: 1, results: [{ group: 'All', value: 42 }] }]}
        onApply={onApply} onClose={() => setOpen(false)} />}</>;
    }
    render(<Harness />); screen.getByRole('button', { name: 'Preview' }).focus(); fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true }); expect(screen.getByRole('button', { name: 'Apply reviewed layout' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' }); expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByText('All: 42')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onApply).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus();
  });
});
