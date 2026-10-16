import { describe, expect, it } from 'vitest';
import { SERVER_DATASET_PAGE_SIZE } from '../DashboardContext';

describe('server dataset catalogue request', () => {
  it('uses a page size accepted by the API', () => {
    expect(SERVER_DATASET_PAGE_SIZE).toBeGreaterThan(0);
    expect(SERVER_DATASET_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});
