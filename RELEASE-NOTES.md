# Release notes

[Overview](README.md) · [Downloads](https://github.com/Maharajahu/ToolBraid-Companion/releases) · [Update guide](INSTALL.md#update)

Release candidates are pre-releases. Dates below describe recorded changes and validation, not a claim that every integration is certified today.

## Repository update — 13 September 2026

- Renamed the official public repository to **ToolBraid-Companion**, with the product title **ToolBraid Companion**.
- Reorganized the README around downloads, capabilities and setup; added separate architecture, full-specification and compatibility references.
- Aligned the transparent logo, paired screenshots, demo and website links. Removed unused presentation assets from the current tree; earlier versions remain in Git history.
- Added bug and feature forms, a non-public security reporting route, and documentation checks for links, assets and checksum-list structure.
- Corrected installation instructions for the required debugger permission and added the AI-assisted setup route.

**Documentation and presentation only:** runtime version `0.3.1`, release tag `v0.3.1-rc.1`, ZIPs, videos, checksum values and Microsoft submissions are unchanged by this repository update.

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
