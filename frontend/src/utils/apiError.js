export const describeApiError = (error, fallback = 'The request failed.') => {
  const response = error?.response;
  const detail = response?.data?.detail;
  const structuredDetail = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null;
  const message = (
    (typeof detail === 'string' && detail)
    || structuredDetail?.message
    || response?.data?.message
    || error?.message
    || fallback
  );
  const recommendation = structuredDetail?.recommendation;
  const requestId = response?.headers?.['x-request-id'];

  return {
    code: structuredDetail?.code || 'REQUEST_FAILED',
    message,
    recommendation,
    requestId,
    text: [message, recommendation, requestId ? `Support ID: ${requestId}` : null].filter(Boolean).join(' '),
  };
};

export const reportExpectedDegradation = (context, error) => {
  console.warn(`[expected-degradation] ${context}`, error);
};
