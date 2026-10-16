# Public launch checks

This checklist covers publication of the **browser-only personal edition**. The server edition needs separate database, authentication, proxy, backup, and service acceptance.

1. Review `git status`, the staged diff, `.gitignore`, and the source tree. Keep `.env` files, credentials, uploads, backups, raw evaluation data, and local audit artifacts outside the publication snapshot. Run `python scripts/scan_secrets.py --build --history` before publishing any existing history. A clean new repository must receive a fresh initial commit; changing a remote URL does not discard old commits.
2. Run `npm.cmd --prefix frontend run check` and the relevant browser tests. If publishing the server edition, also run the backend tests and disposable MySQL/Redis/container checks.
3. Build with `VITE_ENABLE_SERVER_WORKSPACE=false` and `VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=false`. Set `VITE_PUBLIC_SITE_URL` only to the owned HTTPS origin. Preview builds without an origin remain `noindex`.
4. Verify the actual host's HTTPS/HSTS, CSP, caching, compression, 404 behavior, `/api` rejection, canonical pages, sitemap, and workspace `noindex`. Run `npm.cmd --prefix frontend run check:deployment -- https://your-owned-origin` against the deployed site.
5. On a physical device, test import, review, chart/table interaction, original-file download, backup/restore, and storage pressure. Record unsupported cases and check privacy settings for host access logs and any optional analytics.
6. Make the repository public only after the intended source snapshot and commit history have been reviewed. Re-run the secret scan and inspect GitHub's published file list after the first push.

The [assistant status](assistant-status.md) explains why experimental LLM generation remains disabled. The [personal hosting guide](personal-hosting.md) covers static deployment.
