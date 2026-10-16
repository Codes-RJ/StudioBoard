# Application features and limits

The personal edition imports and analyzes data in the browser without an account, API or paid inference service. This reference describes current capabilities and protective policies. See the [interface design](design.md), [security model](security.md), and [launch checks](launch-actions.md) for their respective boundaries.

## Features

- Saved retrieval, summaries, charts and reports scan revision-bound working pages. Lexical retrieval covers every eligible row/declared field while winners and previews stay bounded. Semantic indexing remains separate, explicit and resumable.
- Advanced charts use running stacked/multi-series/streamgraph groups, bounded point projections and exact distribution policies. Median/heatmap/Sankey paths project only needed fields. Original/history streams are omitted from normal analysis.
- Graph calculation projects required fields along approved paths, enforces fan-out/work limits and validates every source revision before returning. Graph examples remain bounded separately from joined execution. Complete identifier indexing reads every nonblank occurrence in up to 16 reviewed key fields, saves pages/cursors atomically, and reports coverage with stable row/field citations.
- Selection opens working rows only. Full review defers originals/history until needed. Partial saves copy preserved streams in the same IndexedDB transaction as the new generation; missing preserved pages abort publication. Background saves and explicit approval reserve their per-source queue before awaiting restore/lazy imports, preventing approval from overtaking a just-started role save. Sorted tables use a stable top-k heap, count the full scope and compare large decimal text without collapsing distinct integers.
- Full quality scans compute missing/type/duplicate/precision-risk counts; profiling declares its evenly spaced sample. Cleaning and relationship workers reject retained work over their explicit policy instead of silently sampling. Unchanged headers avoid an extra normalization copy. Abandoned import staging is checked on startup with the existing refreshed-session/48-hour policy.
- Backup version 6 uses chained SHA-256 NDJSON records, 512-row pages and 64 KiB original-file chunks. Restore verifies counts while staging, recomputes metrics and atomically publishes sources/files/recovery metadata. Versions 1–5 remain readable. Unsaved partial sources are rejected before export so originals/history cannot disappear silently. Export/restore controls expose cancellation, prevent overlapping operations and abort on unmount; legacy restore also passes cancellation into its publication transaction.
- Layouts have canonical IndexedDB state with compare-and-swap, queued writes, notifications and explicit reload/copy recovery. localStorage is a paint cache. Dirty edits survive conflicts; successful copy recovery keeps both layouts.
- Reviewed exact/native precision, unit labels, source grain and calendar choices are implemented. A model-free exact calculator is available for reviewed exact measures. Large integer text requires a precision choice; identifiers remain unchanged. Exact graph/tools/report statistics use BigInt rational arithmetic. Native chart/KPI axes omit exact measures.
- Upload supports PDF text layers, DOCX body paragraphs, Markdown and explicitly selected prose TXT. Documents become page/block-citable text rows and retain their original bytes. Existing folder import remains tabular.
- Agent tools can discover chart cards and propose evidence-validated existing-card edits. Preview checks the current layout/card/source snapshot; explicit apply uses existing undo. Relationship approval stays in its reviewed UI. Six-turn tool limits and source mutation restrictions remain.
- Native keyboard chart-value tables include basic, matrix, financial, hierarchy and parallel-coordinate values with bounded displayed rows. Review loading/recovery dialogs retain focus handling. Existing phone workflows and browser projects are exercised below.
- Collection benchmarks, an opt-in live-model evaluator with fixed thresholds, and pinned/embedded dependency notice collection are implemented. The [measured assistant status](assistant-status.md) explains why generation remains disabled.
- Local greetings/thanks/farewells preserve analytical context. Worker deadlines, consistent unavailable correlations, finite numerical summaries, safer date inference, hostile-header counter protection and sampled, aggregation-aware Smart Layout recommendations have focused tests. See [security controls and remaining boundaries](security.md).

## Data flow and limits

Import stays local -> required type/role/cleaning review -> saved working revision -> validated calculation and evidence workers -> cited explanation or reviewable layout proposal -> local export/backup. Models explain evidence; generated text does not establish numerical facts or directly modify source records. Core imports, cleaning, lexical search, exact calculation and export need no paid inference or downloaded model.

| Path | Enforced policy and actual limitation |
| --- | --- |
| Selected-source UI | Working rows retained in React: 250,000 rows / 32 MiB accounted JSON text. Originals/history deferred. Full review applies a combined retained-data cap. This is not a fully paged UI or constant-memory application. |
| Import | One bounded file/workbook still decodes in memory. Unchanged header normalization reuses records. This is not constant-memory Excel decoding. |
| Running calculations | At most 10,000 groups; display limits apply after full-scope execution. Exact medians retain values and reject excessive scope. |
| Sorted table | Stable heap retains at most 50,000 requested matches (page × limit); every eligible row is counted. Nulls sort last in both directions. |
| Advanced chart | Needed-field projections cap at 250,000 rows / 32 MiB. Point previews use first max(500, visibleItems × 50) eligible rows; surface/mesh/contour use 2,500. Stacked running series retain at most 100 categories × 12 groups. Distribution statistics use full eligible scope under their exact-work policy. |
| Graph | Combined required-field projections cap at 250,000 rows / 32 MiB; joined tuples cap at 250,000. Repeated measure rows and ambiguous paths reject. Examples and structural component summaries are descriptive, not joined numerical facts. |
| Quality/cleaning | Full counts and exact duplicate signatures under retained limits; an explicit strided profile sample. Cleaning/relationship operations cap combined retained work at 250,000 rows / 32 MiB. |
| Reports | Two working-only phases; 250,000 signatures/trend projections/numeric values, 100,000 string groups and 32 MiB accounted content per phase. Phase state is released before the next phase. |
| Backup | 4 MiB records, 200 MiB archive, row pages and file chunks. Final Blob/storage still scales with archive size. Chained checksums detect damage/order changes; they are not encryption or signatures. |
| Exact decimal | Strict decimal/scientific inputs ≤512 characters, absolute scale ≤256, accumulator integers ≤1,024 digits. Terminating fractions render exact decimal strings; repeating fractions retain numerator/denominator. No formatted-currency parsing, conversion or exact standard deviation. |
| Documents | 20 MiB input, 10 MiB extracted text, 20,000 blocks; PDF ≤500 pages, DOCX body XML ≤4 MiB. No OCR, image extraction, password workflow or guaranteed PDF reading order. |

Pages are row-bounded, not byte-bounded. Accounted content excludes JS object/temporary/GC and other-process overhead; these limits are not measured device-capacity guarantees. An already-unsafe stored Number cannot recover digits: exact review requires textual re-import or explicit native approximation. Units label values without conversion. Grain records row meaning/key counts without deleting duplicates or authorizing repeated-measure sums.

Date choices are verbatim values, strict date-only values, or explicit-offset ISO instants grouped in an IANA timezone. Shared grouping applies to tools, native categorical chart groups and deterministic questions. Raw point values and source filters remain unchanged. Rules-mode trend changes compare halves of chronologically ordered observations; equal-duration calendar comparisons are not invented. Single-source tools disclose imputed measure/weight counts. Graph results disclose source/path/grain provenance; joined imputed-cell counts are not implemented.

Identifier indexing is not prose named-entity extraction, and connected components are not algorithmic topical communities. Vector retrieval scans saved chunks rather than a proven ANN index. “Graph edit” here means chart configuration proposals; autonomous relationship rewriting is not implemented. Prompts use character bounds; actual model tokenizer/context behavior remains a live-evaluation gate.


## Storage and recovery

IndexedDB version 7 stores immutable row pages, metadata, original-file chunks, assistant artifacts and staged imports. New originals use exact ArrayBuffer chunks; legacy Blob records remain readable. Selected-source loading, partial saves and layout writes retain revision/conflict checks. Data belongs to its browser profile and origin, so export a backup before changing address or clearing site data.

From Dashboard → **More actions**, ordinary Backup creates a version-6 `.workspace.jsonl` archive. Encrypted backup optionally protects that download with a passphrase and authenticated encryption. Restore accepts both formats, authenticates encrypted files before publication and requires fresh review. Forgotten passphrases cannot be recovered. The open workspace and ordinary backups remain plaintext. See [encryption and recovery](encryption-mfa-design.md).

## Verification, distribution and launch

Use [browser capacity measurements](browser-capacity.md) for instrumented import/backup/restore/switch/cancellation results and their sampling limits. Multi-second pauses remain; desktop fixtures are not physical-device capacity guarantees.

Run `npm.cmd --prefix frontend run check` for contract lint/types, release build, bundle budgets and unit tests. Follow [launch checks](launch-actions.md) for browser, physical-device and hosted acceptance, and [browser-local AI](browser-local-ai.md) for model architecture and limits. Controlled tests do not establish live model quality.

Strict notices passed for 145 packages with zero pending reviews at the final design checkpoint. The reviewed emitted WebGPU/WASM paths exclude the installed GUID implementation; distributing additional runtimes, node_modules or model binaries requires fresh review. [Third-party notices](../THIRD_PARTY_NOTICES.md) describe the boundary. No dependency advisory result is permanent certification.

The selected release keeps `VITE_ENABLE_SERVER_WORKSPACE=false` and `VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=false`. [Personal hosting](personal-hosting.md) is prepared; owned-origin, real CI and physical-device acceptance remain open. Separate server hosting, quotas, downloads and hardware have their own costs and acceptance requirements. No public deployment is established by this reference.
