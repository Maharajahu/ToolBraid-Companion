# Release notes

[Overview](README.md) · [Downloads](https://github.com/Maharajahu/ToolBraid-Companion/releases) · [Update guide](INSTALL.md#update)

Available editions: **Microsoft Store companion 0.3.3.0** and **manual release 0.3.1 RC1**. The extension/runtime version remains **0.3.1**. [Compatibility and signing](docs/compatibility.md#distribution-and-signing).

## Microsoft Store availability — 26 September 2026

- The Windows companion is [available free on Microsoft Store](https://apps.microsoft.com/detail/9P7VF25K2X1R) for Windows 11 build 22000 or later, x64. Microsoft signs and distributes the Store package.
- Install the browser extension separately, enable the sites you choose, then connect your existing MCP client or optional panel chat. [Store setup](INSTALL.md#microsoft-store-companion).
- The manual ZIP remains available under the existing release tag. Its launcher is unsigned; Store certification does not change the ZIP's signing status or certify the separate Edge Add-ons extension.
- The 19 September upload and reply fixes below apply to the manual release and extension; the companion changes are not included in Store 0.3.3.0.

This availability and documentation update does not change the downloadable packages or their version numbers.

<a id="latest-update--19-september-2026"></a>

## Manual release update — 19 September 2026

Runtime **0.3.1** · Release **v0.3.1-rc.1**.

<a id="media-upload-and-reply-fixes--19-september-2026"></a>

### Fixed

- **Windows file selection:** support for standard Open dialogs, retaining exact control checks and sensitive-field exclusions.
- **Media attachments:** uploads can be verified when a page clears or removes its file input, without duplicate selection events. An unconfirmed upload is reported as uncertain rather than retried automatically.
- **X replies beside playing videos:** playback countdowns no longer invalidate a prepared reply. Changes to the post, recipient or editor still require a fresh check.

### Documentation and video

- [Token-efficiency measurement](docs/token-efficiency.md) and a [15-second video](https://toolbraid.pages.dev/#token-efficiency). In one seven-post conversation, ToolBraid returned 821 context tokens versus 5,094 for a full DOM snapshot; custom extraction returned 661. This measures returned context, not total agent usage.

### Validation

- Automated suite: **587 passed, 5 opt-in skipped, 0 failed**.
- Targeted browser/upload and Windows UI checks: **51 passed**. These overlap with the suite and are not additive.
- Live Edge coverage: reply drafting and a video attachment confirmed ready, without publishing. This does not establish complete coverage of every site or X operation.

[Test instructions](docs/development.md#tests-and-optional-integrations) · [Coverage and limitations](docs/compatibility.md#recorded-validation).

### Downloads

Reinstall the complete Windows package and reload its matching unpacked extension. The ZIP launcher is unsigned. Verify the current [checksums](SHA256SUMS.txt).

The named source ZIP corresponds to [889c19d](https://github.com/Maharajahu/ToolBraid-Companion/tree/889c19d4a872fbe111122fd2a97013f16cbe931b). GitHub's automatic archives of the older RC tag contain a different snapshot; use the named source ZIP or clone the repository for the current source.

## Source and runtime refresh — 13 September 2026

Runtime **0.3.1**, release **v0.3.1-rc.1**; no version bump.

Historical source snapshot: [43446d5](https://github.com/Maharajahu/ToolBraid-Companion/tree/43446d5e137e7057cc53dc64fb9c1d49d7052e03). Current download provenance is listed in the manual release update above.

- Published the public extension, companion, Store app source, regression tests and packaging scripts. Added a [build guide](docs/development.md), contribution instructions and source/build CI.
- Added `ToolBraid-0.3.1-source.zip` alongside refreshed Windows, unpacked-extension and Edge submission ZIPs. The release's checksum file identifies the new bytes; the dedicated source ZIP is distinct from the historical tag's automatic GitHub archives.
- **MCP discovery:** content updates no longer discard already-listed tools. An unknown exact tool name triggers one fresh lookup; stale aliases are not substituted and interrupted actions are never replayed.
- **Live pages:** read handles survive content-only updates while retaining exact URL, tab, frame and session binding. Mutations and file attachment remain strictly bound. Navigating to another page rejects the old handle.
- **Scrolling:** root viewport scroll tolerates content changes on the same prepared URL. Nested scroll targets keep their strict fingerprint checks.
- Updated the extension's GitHub link to the canonical Companion repository.

**Validation:** public-source suite **580 passed, 4 opt-in skipped, 0 failed**. Its scope differs from the earlier 616-test suite. **77 targeted checks** and **12 read-only live X checks** covered cached reads, page-binding rejection and scrolling. Replies were verified through rendered-page reads; automatic account/postcondition confirmation remains incomplete.

**8 offline Chromium X workflow scenarios** also passed. Full packaged-companion end-to-end coverage was not established for this historical refresh.

Reinstall the Windows package, reload its matching unpacked extension and restart an existing MCP connection once. The ZIP launcher is unsigned.

## Repository update — 13 September 2026

- Added architecture, full-specification and compatibility references.
- Added paired interface previews and a playable Windows demo.
- Added bug and feature forms, a non-public security reporting route, and documentation checks for links, assets and checksum-list structure.
- Corrected installation instructions for the required debugger permission and added the AI-assisted setup route.

Documentation-only changes; no runtime changes in this entry.

## 0.3.1 RC1

[Release assets](https://github.com/Maharajahu/ToolBraid-Companion/releases/tag/v0.3.1-rc.1) · Runtime `0.3.1`

### Fixes and validation — 13 September 2026

The Windows, manual-install extension and Edge submission ZIPs were refreshed without a version bump. [SHA256SUMS.txt](SHA256SUMS.txt) identifies these bytes.

- **Reliable reconnection:** the MCP connector rereads validated configuration; concurrent requests share a reconnect and interrupted actions are not automatically replayed.
- **Advanced permissions:** `debugger` is declared at installation/re-enablement. Removed the invalid optional-permission request. Basic page tools still do not attach the debugger.
- **X workflows:** improved page and nested scrolling, exact post/reply targeting, composer recovery and reply verification, with media controls and article draft editing.
- **Action handling:** corrected stale tool/session recovery, navigation, cancellation, approval boundaries and scoped-file handling.

Recorded application checks: **616 passed, 4 opt-in checks skipped, 0 failed**, including all **8 MCP server tests**. Real Chromium extension checks covered the required debugger permission. Live X reading and explicitly authorized replies were exercised; broader media/article coverage remains fixture-based. See [validation boundaries](docs/compatibility.md#recorded-validation).

To update, reinstall the Windows package, reload its matching unpacked extension and restart an existing MCP connection once.

### Added in 0.3.1

- Native WebMCP interoperability for JSON-string schemas/arguments as well as object-based contracts, retaining one-use page/frame/session-bound handles.
- Optional **Buy me a coffee** and **GitHub** footer links, opening separately without embedded payment or tracking scripts.
- A real Windows demo with live page/model responses and an X reply draft. The playable video is 1080p; the downloadable 4K export is reframed/upscaled, not native 4K capture.
- Added Store companion source with browser registration controls and connection diagnostics.

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
