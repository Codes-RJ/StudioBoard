# Incremental frontend contract checks

Run `npm --prefix frontend run check:contracts` for the focused gate, or `npm run test:frontend` for the normal build, bundle and unit checks with this gate first. The application-checks CI job already calls the latter command.

ESLint checks storage, worker references, revision/scope review, delimited parsing and exact/native arithmetic for undefined names, unsafe control flow, duplicate keys, precision-losing literals and dynamic evaluation. Coverage is deliberately explicit in `frontend/eslint.config.js` and `lint:contracts`; add modules as they are reviewed. This is not a claim that the whole frontend is linted.

Lint coverage includes the extracted database/import owners, chart loader and four execution/selection/editing hooks. See [module boundaries](frontend-module-boundaries.md).

TypeScript checks JavaScript through `@ts-check` and JSDoc in exact arithmetic, finite arithmetic and worker payload encoding/decoding. `datasetContracts.d.ts` describes saved rows, string storage generations, revision-bound loaders and the two supported row streams. These are contracts for application-owned messages; they do not replace runtime validation of untrusted input. Existing revision/deletion checks remain in the runtime path.

`frontend/type-tests/contracts.ts` includes positive examples and expected compiler failures for wrong generation/ID/row-stream types, malformed rational values, unknown aggregations and text passed to numeric arithmetic. An unexpectedly accepted negative example fails the gate through an unused `@ts-expect-error` directive. Do not silence failures with `any`, blanket suppressions or unchecked casts; narrow values at the boundary and expand coverage gradually.

ESLint and TypeScript are pinned development tools. They do not add browser runtime packages or change the generation-disabled release settings.
