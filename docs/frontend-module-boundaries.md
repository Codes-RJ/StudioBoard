# Frontend module boundaries

Stable responsibilities are separated across the workspace modules listed below. Existing imports from the provider and local dataset store remain valid.

| Owner | Responsibility |
| --- | --- |
| `useDatasetSelection` | Selected-source loading, abort controller, publication generation and retained working record |
| `DashboardSourceGate` | Source review eligibility, load/recovery notices and conflict actions before mounting the workspace |
| `useLayoutEditing` | Undo/redo, edit sessions and scheduling through the provider's existing save callback |
| `DashboardContext` | Public workspace composition, guest/server persistence coordination and version/conflict policy |
| `useDashboardSummary` | Local/server summary computation and request cancellation |
| `useChartSeries` | Worker/small synchronous chart computation, input identity and cancellation |
| `chartPanelData` | Local/server chart-row loading and table pagination contract |
| `ChartPanel` | Chart configuration, presentation and interactions |
| `localDatasetDatabase` | Database version/schema upgrade, connection lifetime and the single shared write queue |
| `localImportStorage` | Staged import/restore transactions, completeness checks, publication and abandoned-session cleanup |
| `localDatasetStore` | Public storage facade, dataset writes/deletes, originals, artifacts and restored-workspace operations |

Storage extraction does not change schema version 7, store names, transaction store sets or revision comparisons. Import and dataset writes import the same queue owner; do not introduce a second module-local queue or import the facade from the database/import modules. The facade re-exports import functions to preserve callers and mocks.

Selection retains its abort/version guard, and chart execution retains its input-identity guard. Layout editing calls the existing serialized save path; database and multi-tab conflicts remain the persistence owner's responsibility. Larger rendering and persistence functions can be split later around these boundaries; moving every line at once is unnecessary for this incremental refactor.
