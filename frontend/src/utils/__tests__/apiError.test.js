import { describe, expect, it } from 'vitest';

import { describeApiError } from '../apiError';

describe('describeApiError', () => {
  it('formats typed API errors with a support request ID', () => {
    const result = describeApiError({
      response: {
        data: { detail: { code: 'RESULT_TOO_LARGE', message: 'Too large.', recommendation: 'Use a job.' } },
        headers: { 'x-request-id': 'request-123' },
      },
    });

    expect(result.code).toBe('RESULT_TOO_LARGE');
    expect(result.text).toBe('Too large. Use a job. Support ID: request-123');
  });

  it('uses the provided fallback when no response detail exists', () => {
    expect(describeApiError({}, 'Try again.').text).toBe('Try again.');
  });
});

