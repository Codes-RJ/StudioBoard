# Shared analytics contracts

The versioned synthetic inputs in `fixtures/analytics-contracts.v1.json` are
consumed by frontend `sharedAnalyticsContracts.test.js` and backend
`test_shared_analytics_contracts.py`. Normal frontend/backend test commands
include them. They contain no user data and are not runtime application assets.

| Contract | Frontend boundary | Server boundary |
| --- | --- | --- |
| Signed values, observed zero, missing values, decimal measures | Approved scoped calculation and saved-page calculation | CSV loader and descriptive strategy |
| Exact unsafe integers, decimals and repeating averages | Exact scoped/saved calculations and approved relationships | Explicit binary64 approximation expectations |
| Positive, negative, measured-zero and unavailable correlation | Heatmap matrix with complete-pair counts | Pearson strategy and strict JSON output |
| Missing/nonfinite correlation inputs | Pairwise finite filtering | pandas pairwise finite correlation |
| Filters and source identity | Local table scope and scoped mean | Paged server table, then matching explicit statistical scope |
| Missing rows and nonconsecutive source labels | Local selection retains explicit source-row fields | Both IQR and z-score return original index labels |

Intentional edition differences and current limits:

- Reviewed browser exact measures transport decimal/rational strings. Server
  descriptive statistics return binary64 numbers, including unsafe-integer
  approximation; they do not claim an exact-decimal mode. The fixture checks
  this difference rather than rounding browser results to match the server.
- Browser native operations use binary64; decimal expectations use numeric
  tolerance. Browser `count` means populated measure cells. Server descriptive
  `count` counts non-null numeric observations; these coincide for the shared
  numeric fixtures, not for arbitrary text measures.
- Browser filters use case-insensitive literal substrings for all fields.
  Server numeric-column filters use numeric equality when the filter parses as
  a number. The shared numeric filter deliberately asserts different row IDs.
  Server analytics routes do not currently accept dashboard filters; the test
  analyzes an explicitly selected matching frame instead of implying a route
  filter contract.
- The server correlation response retains its matrix-only shape. Complete-pair
  counts are currently exposed by the browser heatmap, not added to that API.
- pandas CSV loading skips wholly blank lines by default. Shared metric CSVs
  have populated source-row IDs so missing measures remain actual observations.
  Browser import retains interior blank records under its existing contract.
- Statistical outlier thresholds/methods are not assumed identical across the
  assistant, sampled browser profile and server strategies. The row-identity
  fixture verifies the server's two methods and the browser's explicit row IDs.

When changing analytics semantics, update this fixture version or add an
explicit case with independently computed expectations. Keep exact inputs as
text. JSON fixtures encode nonfinite inputs as strings because NaN/Infinity
tokens are invalid JSON. Do not replace assertions with values computed by the
same implementation under test.
