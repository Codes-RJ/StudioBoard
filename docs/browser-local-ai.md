# Browser-local assistant

The personal edition keeps imported files, questions, indexes, calculations, and conversation state in the browser. It does not send workspace contents to a hosted inference API. Explicit URL imports and optional model downloads still contact external hosts.

## Modes

| Mode | Behavior | Download required |
| --- | --- | --- |
| Deterministic calculations | Uses application tools over reviewed rows and declared scope. | No |
| Evidence search | Searches local rows and returns bounded citations. | No |
| Semantic search | Adds MiniLM vector scoring to local evidence. | Yes, on request |
| Experimental LLM / agent | Qwen selects validated retrieval, calculation, graph, chart, or layout actions; application tools execute them. | Yes, on request, plus WebGPU |

LLM generation is omitted from release builds. Building with `VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=true` enables an experimental preview, subject to explicit user loading and device support. The [measured status](assistant-status.md) describes the limited evaluation and open quality gates.

## Source and evidence boundaries

An imported source must pass quality and role review before assistant tools use its saved revision. Lexical search scans eligible saved rows and returns row and field identities; stored previews have bounded size. Full semantic indexing is a separate, explicit, resumable operation. Revisions and filters invalidate stale evidence. A citation identifies source evidence; a numerical answer requires a validated calculation rather than a guessed number from prose.

Calculations operate over all eligible rows of a reviewed source, with explicit measure, aggregation, grouping, filter, and row scope. Exact decimal measures use bounded rational arithmetic in supported tools. Reviewed graph relationships can connect sources, but ambiguous paths, incompatible grain, stale revisions, and excessive projections are rejected. Chart and layout proposals require a user review before application. The agent cannot execute generated JavaScript, SQL, arbitrary URLs, or direct data writes.

The model worker only requests reviewed model assets with read-only requests and no credentials or referrer. Model files, semantic indexes, and conversations use separate browser storage from source files and backups. Users can stop or unload a model and delete its cache without deleting workspace data. The open workspace and ordinary backups remain plaintext; encrypted backups protect only the downloaded archive.

## Limits

The browser's storage quota, device memory, model download availability, and WebGPU support vary. Unsupported devices retain deterministic tools and lexical search. Prompt injection in imported text, unsupported natural-language operations, long conversations, actual GPU loss, and physical mobile behavior require further acceptance before generation can be released. See [security](security.md), [capacity](browser-capacity.md), and [application features](application-features.md).
