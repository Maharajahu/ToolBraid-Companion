# Release notes

[Overview](README.md) · [Downloads](https://github.com/Maharajahu/ToolBraid-Companion/releases) · [Update guide](INSTALL.md#update)

Release candidates are pre-releases. Dates below describe recorded changes and validation, not a claim that every integration is certified today.

## Latest update — 19 September 2026

**Version 0.3.1 and release tag v0.3.1-rc.1 are unchanged.** This is a refresh of the existing release, not a new version. Microsoft's existing review remains unchanged.

- **Runtime fixes published:** Windows file selection, reliable media attachment verification and X replies beside playing videos. [Detailed changes and recorded validation](#media-upload-and-reply-fixes--19-september-2026).
- **Added today:** the 15-second, 1080p token-efficiency video with native players on the [website](https://toolbraid.pages.dev/#token-efficiency) and both GitHub READMEs. [Measurement and limitations](docs/token-efficiency.md): 821 returned-context tokens versus 5,094 for the full DOM snapshot in one seven-post conversation; custom extraction returned 661. This is not a total-usage claim.
- **Website and documentation:** dated update notices, the benchmark explanation and links to the refreshed downloads.

**Video/site checks:** playback verified on the live website and official GitHub README; desktop/mobile layout checked; published video and page hashes matched the local files. Runtime validation is recorded below, separately from these presentation changes.

## Media upload and reply fixes — 19 September 2026

Runtime **0.3.1**, release **v0.3.1-rc.1**; version and tag unchanged. Download the refreshed assets and current checksums, not the historical tag's automatic source archives.

Source archive snapshot: [889c19d](https://github.com/Maharajahu/ToolBraid-Companion/tree/889c19d4a872fbe111122fd2a97013f16cbe931b), including bounded Windows test cleanup and a real deadline for media fixture I/O on CI. The following provenance/checksum commit does not change that archive. [Download source](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-source.zip).

- **Windows file selection:** the companion can resolve and operate the standard Open dialog's filename field and Open button. Exact window/process/control checks and sensitive-field exclusions remain in place.
- **Media attachments:** verification retains the exact selected input and trusted browser event receipt when a page clears or removes its file input. It no longer sends duplicate synthetic selection events. If dispatch happened but confirmation is missing, the result explicitly says the outcome is unknown and asks the caller to inspect attachments before retrying.
- **X replies beside playing videos:** playback countdown changes no longer invalidate an otherwise unchanged prepared action. Changes to the post, recipient, editor, URL or binding still invalidate it.
- Includes the previously prepared Store first-run guidance, connection diagnostics and Windows 11 scoped virtualization exclusions in the published source. Publishing that source does not approve or update a Microsoft submission.

**Validation:** 51 targeted checks passed: 42 upload/action/page checks, including real Chromium/CDP selection, and 9 Windows UI Automation checks, including the real Open dialog. On authenticated Edge, ToolBraid prepared a reply and attached a video through a one-use file grant; fresh page reads confirmed the draft, video attachment and upload-ready state. The test draft was cleared without publishing. This is evidence for that workflow, not certification of every website or every X operation.

To run the opt-in browser checks, install Playwright and Chromium (or set the existing `E2E_PLAYWRIGHT_MODULE` and `E2E_CHROME_PATH` overrides), then run `TOOLBRAID_BROWSER_LIVE=1 node --test tests/universal/file-upload-browser.test.mjs` in a shell that supports environment prefixes. In PowerShell, set `$env:TOOLBRAID_BROWSER_LIVE='1'` first. Windows UI checks use `TOOLBRAID_UIA_LIVE=1`.

The full public-source suite additionally passed **587 tests, 5 opt-in skipped, 0 failed**, with browser checks enabled and test concurrency limited to 4. Targeted and full-suite counts overlap and must not be added together.

The refreshed **Edge submission ZIP** is included at version 0.3.1. Microsoft requires a higher manifest version when replacing a previously submitted package, so this same-version refresh has **not** been submitted to Edge Add-ons. The Windows ZIP launcher remains unsigned. Reload the matching unpacked extension and reinstall the complete Windows package to apply both halves of the update.

## Source and runtime refresh — 13 September 2026

Runtime **0.3.1**, release **v0.3.1-rc.1**; no version bump.

Source archive snapshot: [43446d5](https://github.com/Maharajahu/ToolBraid-Companion/tree/43446d5e137e7057cc53dc64fb9c1d49d7052e03). Later checksum/documentation commits do not change that archive. [Download source](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-source.zip).

- Published the public extension, companion, Store app source, regression tests and packaging scripts. Added a [build guide](docs/development.md), contribution instructions and source/build CI.
- Added `ToolBraid-0.3.1-source.zip` alongside refreshed Windows, unpacked-extension and Edge submission ZIPs. The release's checksum file identifies the new bytes; the dedicated source ZIP is distinct from the historical tag's automatic GitHub archives.
- **MCP discovery:** content updates no longer discard already-listed tools. An unknown exact tool name triggers one fresh lookup; stale aliases are not substituted and interrupted actions are never replayed.
- **Live pages:** read handles survive content-only updates while retaining exact URL, tab, frame and session binding. Mutations and file attachment remain strictly bound. Navigating to another page rejects the old handle.
- **Scrolling:** root viewport scroll tolerates content changes on the same prepared URL. Nested scroll targets keep their strict fingerprint checks.
- Updated the extension's GitHub link to the canonical Companion repository.

**Validation:** public-source suite **580 passed, 4 opt-in skipped, 0 failed**. The published suite excludes the old cloud-demo and private CLI-agent tests; its total is not directly comparable with the earlier 616-test snapshot. Before export, **77 targeted regression checks** and **12 read-only live X checks** covered cached reads, page-binding rejection and scrolling across changing content. Two separately authorized live replies were subsequently confirmed by fresh rendered-page reads. Automatic account/postcondition matching did not independently confirm those replies; this remains a known limitation, not a claimed fix.

The exported source also passed **8 offline Chromium X workflow scenarios** through the production MCP endpoint and a real DOM fixture adapter. The full packaged native-companion browser test could not run in this sandbox because Windows registry writes were denied; no fresh full-companion E2E pass is claimed for this refresh.

Reinstall the refreshed Windows package, reload its matching unpacked extension and restart an existing MCP connection once. Source publication and GitHub asset replacement do **not** update Microsoft's submitted MSIX or Edge review. The ZIP launcher remains unsigned.

## Repository update — 13 September 2026

- Renamed the official public repository to **ToolBraid-Companion**, with the product title **ToolBraid Companion**.
- Reorganized the README around downloads, capabilities and setup; added separate architecture, full-specification and compatibility references.
- Aligned the transparent logo, paired screenshots, demo and website links. Removed unused presentation assets from the current tree; earlier versions remain in Git history.
- Added bug and feature forms, a non-public security reporting route, and documentation checks for links, assets and checksum-list structure.
- Corrected installation instructions for the required debugger permission and added the AI-assisted setup route.

**Earlier documentation-only update:** this reorganization did not change runtime packages. The later source/runtime refresh above replaces the ZIPs and their checksums; the demo and Microsoft submissions remain unchanged.

## 0.3.1 RC1

[Release assets](https://github.com/Maharajahu/ToolBraid-Companion/releases/tag/v0.3.1-rc.1) · Runtime `0.3.1`

### Fixes and validation — 13 September 2026

The Windows, manual-install extension and Edge submission ZIPs were refreshed without a version bump. [SHA256SUMS.txt](SHA256SUMS.txt) identifies these bytes.

- **Reliable reconnection:** the MCP connector rereads validated configuration; concurrent requests share a reconnect and interrupted actions are not automatically replayed.
- **Advanced permissions:** `debugger` is declared at installation/re-enablement. Removed the invalid optional-permission request. Basic page tools still do not attach the debugger.
- **X workflows:** improved page and nested scrolling, exact post/reply targeting, composer recovery and reply verification, with media controls and article draft editing.
- **Action handling:** corrected stale tool/session recovery, navigation, cancellation, approval boundaries and scoped-file handling.

Recorded application checks: **616 passed, 4 opt-in checks skipped, 0 failed**, including all **8 MCP server tests**. Real Chromium extension checks covered the required debugger permission. Live X reading and explicitly authorized replies were exercised; broader media/article coverage remains fixture-based. See [validation boundaries](docs/compatibility.md#recorded-validation).

To update, reinstall the refreshed Windows package, reload its matching unpacked extension and restart an existing MCP connection once. Updating GitHub assets does not replace packages already submitted to Microsoft.

### Added in 0.3.1

- Native WebMCP interoperability for JSON-string schemas/arguments as well as object-based contracts, retaining one-use page/frame/session-bound handles.
- Optional **Buy me a coffee** and **GitHub** footer links, opening separately without embedded payment or tracking scripts.
- A real Windows demo with live page/model responses and an X reply draft. The playable video is 1080p; the downloadable 4K export is reframed/upscaled, not native 4K capture.
- Prepared a separate Microsoft Store companion with browser registration controls and connection diagnostics. Last recorded submission state on 13 September: Windows **In certification**, Edge **In review**.

### Known limits

- The ZIP launcher is unsigned. Store signing, once approved, applies to the Store MSIX, not these ZIPs.
- Native WebMCP requires a compatible browser API and site. The isolated real-API check does not certify every default browser configuration.
- Clean-install permission dialogs, Store-installed lifecycle behavior and all third-party AI client/model pairings are not fully validated.
- The Edge submission archive is publisher-only; use the ordinary extension ZIP for Chrome or unpacked Edge.

## 0.3.0 RC1 — 12 September 2026

[Historical release](https://github.com/Maharajahu/ToolBraid-Companion/releases/tag/v0.3.0-rc.1) · Runtime `0.3.0`

- Added native WebMCP discovery and page/frame/session-bound execution handles.
- Added optional streaming panel chat through Codex with ChatGPT sign-in, local history, selected-page sharing, Stop and per-mutation approvals.
- Added developer-focused X catch-ups, linked replies/mentions, draft prompts and optional quiet monitoring without model calls or automatic replies.
- Published separate ChatGPT, external MCP and local-model setup guidance, plus paired high-resolution UI previews.

Recorded suite: **573 passed, 2 opt-in checks skipped, 0 failed**. Chromium/Edge integration and subscription-backed read-only panel chat were exercised. X coverage at this release was fixture-based. Native WebMCP was unavailable in the tested default Edge configuration; ordinary MCP fallback worked. Claude Code and LM Studio guides were not end-to-end certifications.

## 0.2.0 RC1 — 12 September 2026

[Historical release](https://github.com/Maharajahu/ToolBraid-Companion/releases/tag/v0.2.0-rc.1) · Runtime `0.2.0`

- Initial Windows companion, bundled Node.js runtime and manual-install Chrome/Edge extension.
- Added site opt-in, pause control, local workflow capabilities and packaged X actions.
- Published checksummed downloads and a feedback form without a public publisher email.

Recorded suite: **554 passed, 2 opt-in checks skipped**. Isolated Chrome/Edge checks covered reads, local form submission, fixture X actions and pause/restart states; companion installation/update/removal were checked separately. The then-optional debugger permission dialogs required manual validation. The current 0.3.1 refresh uses an install-time permission instead.

Older releases remain available for reference. Their original files and release records are retained; use the current candidate for the latest fixes.
