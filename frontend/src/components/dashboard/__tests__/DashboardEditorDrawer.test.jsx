import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardEditorDrawer from '../DashboardEditorDrawer';

const renderDrawer = (overrides = {}) => {
  const props = {
    open: true,
    currentLayout: {
      layout: [{ i: '1', title: 'Revenue', chartType: 'bar', w: 4, h: 3 }]
    },
    onClose: vi.fn(),
    onAddGraph: vi.fn(),
    onViewCard: vi.fn(),
    onConfigureCard: vi.fn(),
    onDuplicateCard: vi.fn(),
    onResetCard: vi.fn(),
    onRemoveCard: vi.fn(),
    onMoveCard: vi.fn(),
    onResizeCard: vi.fn(),
    onResetDashboard: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  };
  render(<DashboardEditorDrawer {...props} />);
  return props;
};

describe('DashboardEditorDrawer', () => {
  it('adds graph templates and exposes card actions', () => {
    const props = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Add Bar graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add KPI graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Table graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Revenue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Revenue' }));

    expect(props.onAddGraph).toHaveBeenCalledWith('bar');
    expect(props.onAddGraph).toHaveBeenCalledWith('kpi');
    expect(props.onAddGraph).toHaveBeenCalledWith('table');
    expect(props.onDuplicateCard).toHaveBeenCalledWith('1');
    expect(props.onResetCard).toHaveBeenCalledWith('1');
  });

  it('exposes reset and explicit save/cancel actions', () => {
    const props = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Reset entire dashboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save dashboard' }));
    expect(props.onResetDashboard).toHaveBeenCalledOnce();
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it('resizes cards directly from the editor drawer', () => {
    const props = renderDrawer();
    expect(screen.getByText(/4 columns.*3 rows/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Make Revenue shorter' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Make Revenue wider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make Revenue taller' }));
    expect(props.onResizeCard).toHaveBeenNthCalledWith(1, '1', 1, 0);
    expect(props.onResizeCard).toHaveBeenNthCalledWith(2, '1', 0, 1);
  });

  it('closes with Escape', () => {
    const props = renderDrawer();
    const closeButton = screen.getByRole('button', { name: 'Close dashboard editor' });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Save dashboard' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('disables graph types that do not match the dataset', () => {
    renderDrawer({ dataset: { columns: [{ name: 'label', type: 'string' }] } });
    expect(screen.getByRole('button', { name: 'Add Scatter graph' })).toBeDisabled();
    expect(screen.getAllByText('Needs at least two numeric columns.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Add Bar graph' })).toBeEnabled();
  });
});
