import { useEffect, useState } from 'react';
import { computeChartSeries } from '../utils/chartComputation';
import { runLocalTransform } from '../utils/localTransforms';

export default function useChartSeries(chartInput) {
  const [computed, setComputed] = useState(null);
  const [computationError, setComputationError] = useState('');
  useEffect(() => {
    setComputed(null); setComputationError('');
    if (typeof Worker === 'undefined') {
      if (chartInput.rows.length <= 2_000) setComputed({ input: chartInput, result: computeChartSeries(chartInput) });
      else setComputationError('Background processing is required for this chart scope.');
      return;
    }
    const controller = new AbortController();
    runLocalTransform('chart-series', chartInput, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setComputed({ input: chartInput, result }); })
      .catch((error) => { if (error.name !== 'AbortError') setComputationError(error.message); });
    return () => controller.abort();
  }, [chartInput]);
  const series = computed?.input === chartInput ? computed.result : null;
  return { series, computationError };
}
