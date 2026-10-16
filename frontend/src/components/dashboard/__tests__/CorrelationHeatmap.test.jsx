import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CorrelationHeatmap, { correlationColor } from '../CorrelationHeatmap';
import { buildHeatmapMatrix } from '../../../utils/chartDataTransforms';

const matrix = [
  { key: 'Revenue', values: [{ key: 'Revenue', value: 1 }, { key: 'Cost', value: -0.72 }] },
  { key: 'Cost', values: [{ key: 'Revenue', value: -0.72 }, { key: 'Cost', value: 1 }] }
];

describe('CorrelationHeatmap', () => {
  it('renders unavailable cells as N/A with complete-pair counts, separately from measured zero', () => {
    const rows = [{ a: -1, b: 1, constant: 5 }, { a: 0, b: -2, constant: 5 }, { a: 1, b: 1, constant: null }];
    render(<CorrelationHeatmap columns={['a', 'b', 'constant']} matrix={buildHeatmapMatrix(rows, ['a', 'b', 'constant'])} />);
    expect(screen.getAllByText('N/A')).toHaveLength(5);
    expect(screen.getAllByText('0.00')).toHaveLength(2);
    expect(screen.getByLabelText('a and constant: N/A; 2 complete pairs')).toBeVisible();
    expect(screen.getByLabelText('a and b: 0.00; 3 complete pairs')).toBeVisible();
    expect(correlationColor(null)).not.toBe(correlationColor(0));
  });

  it('renders an annotated, responsive correlation matrix and color scale', () => {
    const { container } = render(<CorrelationHeatmap columns={['Revenue', 'Cost']} matrix={matrix} />);
    expect(screen.getByRole('img', { name: /annotated Pearson correlation matrix/i })).toBeVisible();
    expect(screen.getByTestId('correlation-heatmap')).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
    expect(screen.getAllByText('1.00')).toHaveLength(2);
    expect(screen.getAllByText('-0.72')).toHaveLength(2);
    expect(container.querySelectorAll('rect')).toHaveLength(44);
  });

  it('uses a seaborn-style coolwarm diverging scale centered on zero', () => {
    expect(correlationColor(-1)).toBe('rgb(59,76,192)');
    expect(correlationColor(0)).toBe('rgb(247,247,247)');
    expect(correlationColor(1)).toBe('rgb(180,4,38)');
  });
});
