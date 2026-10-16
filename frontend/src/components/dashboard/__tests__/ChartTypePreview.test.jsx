import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChartTypePreview from '../ChartTypePreview';
import { CHART_TYPE_OPTIONS } from '../../../utils/chartCatalog';

describe('ChartTypePreview', () => {
  it.each(CHART_TYPE_OPTIONS)('renders a responsive SVG preview for $label', ({ value }) => {
    const { container } = render(<ChartTypePreview type={value} />);
    const preview = container.querySelector(`svg[data-preview-type="${value}"]`);
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute('viewBox', '0 0 120 52');
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('uses a diverging matrix thumbnail for a heatmap instead of generic bars', () => {
    const { container } = render(<ChartTypePreview type="heatmap" />);
    expect(container.querySelectorAll('rect')).toHaveLength(16);
    expect(new Set([...container.querySelectorAll('rect')].map((cell) => cell.getAttribute('fill'))).size).toBeGreaterThan(2);
  });
});
