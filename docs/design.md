# Interface design

The interface uses warm paper surfaces, forest-green type and controls, restrained terracotta accents and inline SVG diagrams. See [application features](application-features.md) for analytical behavior and [launch checks](launch-actions.md) for remaining acceptance work.

## Pages and sections

| Page | Sections and controls |
| --- | --- |
| Home `/` | Navigation; hero with working file-upload and sample actions plus a sample chart; illustrated import/review/explore workflow; capability overview; closing import action; shared footer |
| How it works `/how-it-works` | Illustrated introduction; four step links; import and preservation; review and relationships; charts/tables/layouts and assistant; exports/reports/backup/recovery; quiet practical-limit note; footer |
| Import `/upload` | Compact introduction and Import → Review → Explore progress; local/URL tabs; file drop/picker; folder/workbook guidance; sample data; visible capacity summary with information control; source overview/review as required |
| Dashboard `/dashboard` | Source review/recovery gate; shared source/layout toolbar; workspace information; compact assistant; metrics; editable charts and table; contextual layout controls; report/export/backup dialogs |
| Privacy `/privacy` | Compact illustrated header; local storage, requests/downloads, backup/encryption, deletion and optional server boundaries; footer |
| Terms `/terms` | Compact illustrated header; use, ownership, storage/recovery, accuracy, availability and applicable-law limits; separate MIT source-license rights; footer |
| Not Found | Matching 404 route illustration; clear Home and Dashboard actions; shared navigation/footer |

Personal login/admin routes redirect to the local dashboard. A separately enabled server edition retains its account/admin screens; it is outside the initial personal release.

## Public-page presentation

The desktop Home navbar and hero together target 88% of the viewport. The previous full-height hero was superseded by the shorter approved design. Phones use natural content height. The first hero no longer carries the repeated “CSV and Excel / No account required” line.

On desktops at least 1024px wide, the guide opening (navbar, introduction and four step links) and each of its four workflow sections target 98% of the viewport height. Enlarged text can increase the height rather than clipping content. Phones and smaller tablets use natural height. The guide describes all supported feature groups and their limits, including documents, reviewed relationships, exact calculation, assistant/search, reports, exports and ordinary/encrypted backups. It presents **40+ charts and card types** with bar/line/scatter SVG examples; the workspace retains its actual chart catalog.

Artwork uses open paper backgrounds, fine forest outlines and a common alignment system. Diagrams explain actions: files entering a workspace, missing-value review, charts, portable copies, numbered terms and a return-home route. Privacy artwork distinguishes the browser workspace from an optionally encrypted backup. Informative illustrations have accessible names; decorative art stays out of the accessibility tree and keyboard order. SVG assets are part of the frontend rather than external image downloads. The social preview is captured from the actual landing page.

Framer Motion `14.1.0` uses the small `framer-motion/dom/mini` entry for public scroll reveals. Noninteractive sections move 44px over 900ms with staggered timing. Sections containing controls fade in place so targets remain steady during clicks. Keyboard focus finishes a reveal, reduced-motion changes cancel effects and restore styles, and prerendered content stays visible without JavaScript. Public SVGs lift slightly with a shadow on hover. Touch and reduced-motion devices keep them still. A small green cursor glow runs only with a suitable pointer; the discarded cursor-background effect is absent. Import and Dashboard do not mount these public effects.

The themed loading skeleton appears in the original HTML shell, lazy-route fallback and prerendered workspace HTML. Its styling is available before JavaScript; reduced motion disables shimmer. Route suspense resets on pathname changes so a deferred page displays the skeleton. Loading status announces no workspace content.

## Workspace

Import brings the file picker into the initial view. A static SVG flower extends halfway beyond the main panel, behind its translucent surface. Backdrop blur has an opaque fallback. The capacity summary distinguishes import admission from narrower retained-operation limits before expensive work; its information button reveals the complete guidance. Multiple files, folders, worksheet selection, documents, URL imports and cancellation keep their existing workflows.

Dashboard uses one `DashboardToolbar` for custom and generated layouts. Dataset selection, Open File, layout selection, Smart Layout and Edit dashboard are visible. **More actions** groups Data Health, reports, exports and ordinary/encrypted backup/restore. **Layout options** groups card insertion and layout management. Remote controls appear for remote sources. The default graph-color selector and standalone limits dropdown were removed; per-chart colors and restored palette settings remain supported.

The top-right workspace information button explains storage and capacity. The assistant information button contains its actual mode, model, indexing and cache controls. These nonmodal panels expose named controls and expanded state, support Tab/Escape/close/outside-click interactions, and keep operation contents mounted while closed. Backup dialogs retain their modal focus handling.

The assistant query stays visible; examples and conversation start collapsed. Asking opens the answer, and collapse/reopen preserves it. Errors, restoration and operation status remain independently visible. Summary cards share one presentation and use two columns on phones. Charts and tables share compact headings, padding, paper backgrounds and quiet axes/gridlines. Sorting/filtering/export and accessible chart-value tables remain available. Editing controls wrap within narrow screens.

## Shared footer and implementation owners

The outlined **Visit me ↗** pill differs from the filled import action and currently links to Home. Set only `PORTFOLIO_URL` in [portfolio.js](../frontend/src/config/portfolio.js) to the eventual full HTTPS address, then rebuild. All footers and prerendered public pages use that value. An HTTPS destination opens in a new tab without opener access; the existing unsaved-layout guard remains active.

Shared owners are `SiteChrome`, `PageMotion`, `RouteSkeleton`, `WorkflowIllustration`, `LegalIllustration`, `NotFoundIllustration`, `ImportBloom`, `DashboardToolbar`, `DisclosurePanel` and `BrowserImportLimits`. Continue using the shared tokens/components instead of copying per-page colors or portfolio destinations.

## Verified scope and remaining acceptance

The final design checkpoint on 11 October 2026 passed production client/SSR/prerender, contract lint/types, existing bundle budgets and strict notices (145 packages, zero pending reviews). The Dashboard route measured 121.2 kB raw / 35.0 kB gzip and the shared entry 128.5 kB raw against its unchanged 130 kB cap. Public motion has a separate 15 kB raw / 6 kB gzip budget. These are recorded checkpoint results, not tests rerun by later documentation edits.

All 22 focused unit tests passed. The final Chromium workspace cohort passed 31 checks with one server-only skip; a ten-check public/responsive pass covered five public upgrades, two SEO checks and three repeated workspace sizes. Windows WebKit passed six selected workspace/backup checks through its explicit functional profile. Coverage included imports/review, document citations/originals, exact arithmetic, table operations, backups, layout editing/history/reload, phone-width controls, information panels, chat state and the portfolio fallback. Earlier public checks also exercised loading, hover, reduced-motion changes, guide geometry, keyboard focus, doubled text and no-JavaScript rendering.

Public captures at 1440×900 and 390×844 and workspace captures at 1440, 390 and 360 CSS-pixel widths recorded no horizontal overflow. Workspace geometry kept file selection in the initial view and a chart in the desktop first screen. Supporting screenshots and logs remain local and are not shipped assets.

Physical Android, iOS, screen-reader, weaker-device, real CI and hosted-edge acceptance remain open. Follow [launch checks](launch-actions.md); desktop emulation does not close those gates. Subsequent design work should respond to those results and measured chart/table usability or responsiveness issues.
