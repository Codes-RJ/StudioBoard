# Free hosting for the personal edition

The prepared static-host path uses **Netlify Free** and its supplied `https://PROJECT-NAME.netlify.app` address. This is a provider choice, not an existing reserved address. An owned account/project and final URL are still needed; nothing has been published.

In simple terms: Netlify sends the app's files to visitors. Each visitor's browser does the analysis and keeps their imported data locally. We do not need to rent a server, buy a domain or pay for an inference API. Use a genuinely Free account/plan and its included address; paid add-ons are outside this choice.

## Why this host

As checked on 16 October 2026, the credit-based Free plan is $0/month with 300 monthly credits and a hard limit, without automatic recharge. Usage consumes that allowance; exhaustion can pause delivery. This is a budget-safe starting point with limited availability, not unlimited hosting. Check the actual account's plan before launch, especially if it is on a legacy plan. [Netlify plan details](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/).

The current metering is 15 credits per successful production deploy, 20 credits per GB served and 2 credits per 10,000 web requests. These share the same allowance. Large JavaScript/WASM downloads and repeated releases use it; it cannot be translated into a guaranteed visitor count. Preview deployments do not consume the production-deploy charge, but their requests/bandwidth still count. [Credit rules](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).

Cloudflare Pages has a 25 MiB per-file limit. This build emits a 26,861,777-byte ONNX asyncify WASM file, exceeding 26,214,400 bytes. Using Pages would require another asset-delivery decision or a verified runtime-distribution change, so it is not the selected direct-upload path. The binary is retained rather than silently removed. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

## Prepared repository configuration

[`netlify.toml`](../netlify.toml) builds from `frontend` and publishes only `dist`. The dependency-free `build:netlify` wrapper forces both server workspace and experimental generation off, runs the ordinary release build/public-env validator, then writes static `_headers` and `_redirects`. Those files also travel with a manual upload of `dist`; uploading a root TOML file alone would not configure a manual static deployment.

Headers reuse the application's CSP and security policy, add HSTS, cache hashed assets immutably, revalidate known HTML/metadata and mark workspace routes noindex. Known routes use generated HTML; API requests and unknown paths get a real 404. There is no blanket successful SPA fallback. [Netlify headers](https://docs.netlify.com/manage/routing/headers/), [redirect syntax](https://docs.netlify.com/manage/routing/redirects/redirect-options/) and [build configuration](https://docs.netlify.com/build/configure-builds/file-based-configuration/).

No hostname is guessed. Set `VITE_PUBLIC_SITE_URL` to the project's actual stable HTTPS origin in its **production** build environment once known. Branch/deploy-preview contexts explicitly clear it so preview pages stay noindex. Empty-origin local builds remain noindex. Netlify build previews use the same disabled release flags.

## Account and first deployment

1. Use an account you control and select **Free**. Keep the included `netlify.app` address; no domain purchase or paid AI/database/function service is needed. If connecting a repository, verify that connection is included in your actual plan. Manual static upload is also supported.
2. Establish the project's stable name/address. If a first draft upload is needed to create the project, build with an empty public origin so that draft remains noindex. Review project visibility before making it public. Do not rename the address after users begin saving workspaces without an export/move plan.
3. Disable the injected **Powered by Netlify** badge in project configuration. Netlify documents a per-project off switch, including Free projects; new Free projects can start with it enabled. Our CSP should remain strict. The injected badge/pre-launch script and actual edge behavior still need hosted verification. [Badge settings and CSP behavior](https://docs.netlify.com/manage/projects/powered-by-netlify-badge/).
4. After the address is known, set the production public origin and build the exact reviewed tree. Publishing remains a user-authorized step, separate from preparing this configuration.
5. Follow the [launch checks](launch-actions.md) before declaring launch readiness, including actual large WASM delivery, routing, caching, compression, security headers and browser workflows. Local builds do not certify the host's edge or current upload limits.

For a manual build, from the repository root, substitute only the owned project origin:

```powershell
$env:VITE_PUBLIC_SITE_URL = 'https://YOUR-PROJECT.netlify.app'
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build:netlify
```

Upload only `frontend/dist` after approval; include its generated `_headers` and `_redirects`. Do not upload source workspaces, backups, env files, model caches, browser profiles, uploads or `node_modules`. The browser-only application needs none of them on the host. For local preview without indexing, leave the public origin empty.

## Data, privacy and remaining acceptance

Export browser workspaces before changing origin. A workspace at `localhost` will not automatically appear at `netlify.app`; restore the backup at the new origin and review it again. Ordinary backups are plaintext; use the existing encrypted-backup option if desired and keep its passphrase separately.

The host and explicitly contacted model/file providers can receive ordinary network/IP/access information. Inspect the actual account's logging/retention and optional analytics before release. Application-local analysis does not certify provider log privacy. Verify current quotas, log settings and the authorized host probe during [launch checks](launch-actions.md). Existing optional model downloads are separate from Netlify traffic if fetched directly from their pinned provider; locally hosted runtime assets still count toward host bandwidth.

Remaining operator information: owned Netlify project URL, confirmation that the account is Free, visibility/injected-feature settings, and authorization for the concrete deployment. Device testing uses whatever phone/computer is already available. No purchase is required to provide those results.
