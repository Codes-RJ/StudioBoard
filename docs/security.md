# Security model

This describes implemented boundaries, not a penetration-test certification. The default personal edition is a static browser application. Server workspace and experimental LLM generation are disabled in its release build.

## Personal workspace

- Imported files, working rows, conversations, and indexes are stored in the browser. Explicit HTTPS URL imports contact the selected source; optional model downloads contact fixed model-asset hosts. The static host still receives ordinary request metadata and access logs.
- Imported values are treated as data. React renders text, spreadsheet exports escape formula-leading cells, and source/row identifiers and quality counters handle hostile field names. File, row, memory, archive, and worker limits reduce resource exhaustion, but do not guarantee every supported-size file will fit on a weak device.
- Saved calculations and evidence validate source revisions, approved roles, scope, and citations. Experimental agent tools are allowlisted; chart/layout changes require review. Prompt injection and new question wording are not proven safe. An earlier model test produced a credential-seeking clarification and planner text; no actual credential was leaked in that controlled test. [Experimental generation remains disabled](assistant-status.md).
- Backups can be encrypted with authenticated encryption. Ordinary backups and the open browser workspace are plaintext. A malicious same-origin script, extension, or device user can access an unlocked workspace; backup encryption does not change that boundary.
- Production builds omit source maps by default and set security headers, `noindex` for workspace routes, and a 404 for unknown routes. Actual HTTPS/HSTS, caching, compression, and edge headers must be checked on the deployed host.

## Separate server edition

The optional FastAPI edition adds authentication, server uploads, MySQL, Redis, workers, and administrative operations. It requires its own production secrets, narrow host/origin/proxy settings, shared rate store, database grants, backups, and live deployment checks. Do not enable it by changing a browser preference; both frontend and backend build/deployment flags are required. See [deployment](deployment.md).

## Publication and dependency checks

The repository ignores populated `.env` files, credentials, local datasets, raw audit reports, backups, and generated model caches. On 16 October 2026, a redacted high-confidence scan found no selected key or private-key patterns in current source/build files or 4,484 historical Git blobs. Binary assets were byte-scanned but not semantically inspected; pattern matching cannot prove that all secrets are absent. Local `.env` values were checked without printing them. A development JWT value matches the public example and must be replaced before any server deployment.

Locked npm and hash-locked Python dependencies, license notices, source/build secret scanning, and dependency audits are checked in CI. Refresh the advisory scan and inspect the actual build before a public deployment. A **new repository with a fresh initial commit** is required if historical internal documents must stay private; changing the Git remote alone preserves old commits. Follow the [launch checks](launch-actions.md).
