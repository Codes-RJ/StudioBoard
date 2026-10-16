import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GraphConfigurationPanel from '../GraphConfigurationPanel';
import { getGraphSelectorConfig } from '../../../utils/graphConfiguration';

const columnGroups = {
  all: ['segment'],
  numeric: [],
  categorical: ['segment'],
  date: [],
  dimensions: ['segment'],
  measures: []
};

const configuration = {
  chartType: 'scatter',
  preferredX: '',
  preferredY: '',
  dataScope: 'full',
  dataLimit: 180,
  dataPage: 1,
  sortBy: '',
  sortOrder: 'asc',
  aggregation: 'auto',
  topN: 12,
  colorPalette: 'inherit',
  seriesColor: '',
  showLegend: true,
  showDataLabels: false,
  numberFormat: 'auto',
  decimalPlaces: 2,
  currency: 'USD',
  w: 4,
  h: 3
};

describe('GraphConfigurationPanel', () => {
  it('explains invalid graphs and offers compatible alternatives', () => {
    const onChartTypeChange = vi.fn();
    render(
      <GraphConfigurationPanel
        configuration={configuration}
        columnGroups={columnGroups}
        selectorConfig={getGraphSelectorConfig('scatter', columnGroups)}
        validation={{ valid: false, issues: ['Needs at least two numeric columns.'], compatibleTypes: ['line', 'bar'] }}
        onChartTypeChange={onChartTypeChange}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('This graph needs attention')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'bar' }));
    expect(onChartTypeChange).toHaveBeenCalledWith('bar');
  });

  it('emits persistent appearance changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <GraphConfigurationPanel
        configuration={{ ...configuration, chartType: 'bar', numberFormat: 'currency' }}
        columnGroups={columnGroups}
        selectorConfig={getGraphSelectorConfig('bar', columnGroups)}
        validation={{ valid: true, issues: [], compatibleTypes: ['bar'] }}
        onChartTypeChange={vi.fn()}
        onChange={onChange}
      />
    );

    const panel = within(container);
    fireEvent.change(panel.getByLabelText('Graph color'), { target: { value: 'orange' } });
    fireEvent.change(panel.getByLabelText('Primary color'), { target: { value: '#123456' } });
    fireEvent.click(panel.getByLabelText('Show legend'));
    fireEvent.click(panel.getByLabelText('Show data labels'));
    fireEvent.change(panel.getByLabelText('Currency'), { target: { value: 'INR' } });

    expect(onChange).toHaveBeenCalledWith({ colorPalette: 'orange' });
    expect(onChange).toHaveBeenCalledWith({ seriesColor: '#123456' });
    expect(onChange).toHaveBeenCalledWith({ showLegend: false });
    expect(onChange).toHaveBeenCalledWith({ showDataLabels: true });
    expect(onChange).toHaveBeenCalledWith({ currency: 'INR' });
  });

  it('shows the current card size and emits bounded resize requests', () => {
    const onResize = vi.fn();
    render(
      <GraphConfigurationPanel
        configuration={configuration}
        columnGroups={columnGroups}
        selectorConfig={getGraphSelectorConfig('scatter', columnGroups)}
        validation={{ valid: false, issues: ['Needs at least two numeric columns.'], compatibleTypes: ['bar'] }}
        onChartTypeChange={vi.fn()}
        onChange={vi.fn()}
        onResize={onResize}
      />
    );

    expect(screen.getByText(/4 columns.*3 rows/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Increase graph width' }));
    expect(screen.getByRole('button', { name: 'Decrease graph height' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Increase graph height' }));
    expect(onResize).toHaveBeenNthCalledWith(1, 1, 0);
    expect(onResize).toHaveBeenNthCalledWith(2, 0, 1);
  });
});
