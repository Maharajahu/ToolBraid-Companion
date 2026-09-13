# ToolBraid 0.3.1 — native WebMCP compatibility and real Windows demo

Public release candidate, updated 13 September 2026. Runtime version `0.3.1`; GitHub tag [`v0.3.1-rc.1`](https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.3.1-rc.1). This is a pre-release, not a stable or Microsoft-approved launch.

## Downloads

The extension now includes a compact footer with optional Buy Me a Coffee support and the official GitHub project link. Both open in a separate tab; no payment form, tracking script, new permission or paid feature is added. The Windows companion MSIX already submitted to Microsoft is unchanged by this UI update. The ZIP edition includes the updated extension and documentation.

- `ToolBraid-0.3.1-windows-x64.zip` — Windows x64 companion, bundled Node.js, installer and matching extension.
- `ToolBraid-0.3.1-extension.zip` — matching extension only; requires the Windows companion.
- `ToolBraid-Windows-real-demo-4K.mp4` — the real Windows walkthrough, without audio.
- `SHA256SUMS.txt` — SHA-256 checksums for the two ZIPs and demo.

Use the release **Assets**, not GitHub's Source code archives. See the [installation and update guide](INSTALL.md). Existing 0.3.0 release assets are not replaced.

## What changed

- Fixed native WebMCP interoperability with browsers that return a JSON-string input schema and require JSON-string arguments. Newer object-based contracts remain supported. Execution still uses a one-use, page/frame/session-bound handle and is not automatically retried.
- Added regression coverage for both native contracts and an opt-in test that registers, discovers and executes a real native WebMCP page tool in Chromium 151 with its experimental WebMCP flag.
- Added the approved real Windows demo to the website and both public repository presentations. It shows an actual model reading the live website and a public X conversation, drafting a reply without posting it, and navigating to GitHub after approval. Built-in chat is optional: the conversation can stay in an existing Codex session through MCP.
- Added a lightweight, click-to-play 1080p website copy, a poster and a visual text description. The downloadable file is a 3840 × 2160 export of an approximately 2566 × 1452 Windows capture, with edits and reframing, not native 4K capture. Recorded UI is 0.3.0.
- Synchronized the package's installation guide with the online ChatGPT, external MCP client and local-model instructions. Included these release notes in the companion. No new Claude, Ollama or LM Studio backend is being claimed.
- Added a Microsoft Store companion: a native Windows connection window, separate local connection data, restorable public browser registrations and stable MCP/native-host execution aliases. Version 0.3.1.0 was submitted on 13 September 2026; Partner Center confirmed **In certification**. It is not yet approved or available for download. Store-installed lifecycle testing is not claimed.

- Added **Check connection** to the Store companion: runtime/configuration checks, MCP initialize/ping and authenticated extension status, with a separate no-page state. Reports omit URLs, titles, tokens, paths and raw errors. No browser action or model request is sent; AI sign-in is not tested. This is not a new button in the ZIP edition.
- Prepared a Store listing draft and reviewer packet covering capabilities, retention, disconnect-before-uninstall and certification gates. Added diagnostic and compiled Store-launcher tests: **16 passed**, plus isolated C# registration/ACL checks. These use a fixture extension and test-only configuration, not installed Store aliases or a live browser.
- Added a separate `ToolBraid-0.3.1-edge-extension.zip` for Edge Add-ons after Microsoft's package validator rejected the Chrome unpacked manifest's `key`. The Edge artifact omits only that field; the Chrome archive retains its stable public key. The corrected Edge package passed Microsoft's upload validation on 13 September 2026. Upload validation is not store certification or publication.
- Reserved the Windows application identity and obtained the actual Edge Add-ons CRX ID for the MSIX browser allowlist. Windows Companion is in certification. Edge Add-ons remains a separate, unpublished submission.
- Corrected the Windows package after Microsoft rejected hidden helper applications. One visible companion now declares one execution-alias extension with both aliases pointing to the bundled connection launcher; the MCP configuration selects `--mcp`. Manifest checks and all 16 Store diagnostic/launcher tests pass. This avoids claiming permission to publish a headless application; restricted capabilities still need Microsoft's approval.

## Validation and remaining gates

The prior full automated suite passed **575 tests**, with **two opt-in tests skipped** and zero failures. The native WebMCP check used the real browser API on an isolated localhost page; it does not certify the full native extension-to-MCP pipeline or default Edge availability. The footer update passed **18 side-panel tests and 2 build tests**, plus an isolated Chromium render at 320, 400 and 760 CSS pixels, keyboard focus and separate-tab/no-opener/no-referrer checks. External destinations were intercepted for navigation tests; no payment was made.

The recorded Windows demo supplies real website/X read and reply-draft evidence. **No live X post, reply, like, repost or quote was submitted.** Automated mutation coverage remains fixture-based.

- Clean-install native site-access and optional-debugger grant/decline dialogs still need manual testing.
- Claude Code is installed but signed out on the validation machine; LM Studio is not installed. Their documented setup paths are not end-to-end certified.
- The downloadable Windows launcher is **unsigned**. The selected free signing route is Microsoft Store distribution of an MSIX after certification; that does not sign the independent ZIP/EXE. No self-signed certificate is installed or treated as publicly trusted. Checksums are not a publisher signature. Do not disable security protections.
- Final Edge Add-ons privacy declarations, listing material and store review remain outstanding. The publisher account and actual store extension ID are now available. Chrome uses manual ZIP installation.
- The privacy policy documents optional external support links, local retention and provider data transfers. No model, subscription or API credit is included.

Website: [toolbraid.pages.dev](https://toolbraid.pages.dev/). Support: [Feedback form](https://toolbraid.pages.dev/feedback/). Do not send secrets, authentication files or private page content.

# ToolBraid 0.3.0 — WebMCP, chat and developer communities

Public release candidate, 12 September 2026. Runtime version `0.3.0`; GitHub tag [`v0.3.0-rc.1`](https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.3.0-rc.1). This is a pre-release, not a stable or Microsoft-approved launch. Edge Add-ons approval is still pending; Chrome remains a manual ZIP installation.

## Downloads and update

- `ToolBraid-0.3.0-windows-x64.zip` — complete Windows x64 companion, installer, bundled Node.js and matching extension. Use this for a new installation or to update both components together.
- `ToolBraid-0.3.0-extension.zip` — extension only; requires the matching Windows companion.
- `SHA256SUMS.txt` — SHA-256 checksums for both ZIPs.

Download from the release **Assets** section, not GitHub's automatically generated Source code archives. Follow the [installation and update guide](https://github.com/Maharajahu/toolbraid-releases/blob/main/INSTALL.md). Integrated chat also requires a current Codex installation and your own ChatGPT account with Codex access; no subscription is included.

## New in 0.3.0

- Native WebMCP site-tool discovery and one-use, page/frame/session-bound execution handles on compatible browsers and sites.
- Streaming agent chat inside the side panel through official Codex App Server. **ChatGPT sign-in only: no API key and no separate model API billing.** Your own account's Codex limits apply.
- Recent local conversation history, explicit selected-page sharing, visible activity, Stop, and exact per-action approval before browser mutations. Existing external MCP direct control is unchanged.
- Developer-focused X catch-ups: rendered replies/mentions, exact post links, reply-draft prompts and optional quiet monitoring of one dedicated tab. No automatic replies, DMs or model calls from monitoring.
- Updated product explanation, original article artwork, Follow and optional Buy Me a Coffee links, and feedback without a public publisher email.

## Validation and limitations

### Documentation update — 12 September 2026

- Paired the approved high-resolution screenshots side by side on GitHub and the website, with aligned headings, consistent framing and individual full-resolution links. Original image files are unchanged.
- Replaced the small presentation screenshots with lossless 1440-pixel-wide captures rendered from the public UI at 125% zoom and 3× pixel density, with offline test data and explicit provenance. Enlarged website/README presentation and added full-resolution image links; preserved the original live Edge chat capture as evidence. This does not change the application or add a new live integration test.
- Made the built-in chat explicitly optional, with separate setup paths for ChatGPT, external MCP clients and local models.
- Added ChatGPT sign-in, model selection, page-sharing and connection troubleshooting instructions.
- Added a Claude Code subscription-client configuration example and an LM Studio local-model/MCP guide, grounded in their official documentation. Neither pairing is claimed as end-to-end certified.
- Clarified subscription versus API billing, external-client approval behavior, local inference versus network traffic, and the absence of built-in support for other providers or Ollama/LM Studio endpoints.
- These are website and GitHub documentation changes only. Runtime version, published ZIP files, checksums and release tag are unchanged; no new provider integration is being claimed. The online setup guide is more recent than the documentation bundled inside the original ZIPs.
- Documentation checks: responsive rendering at 320, 390, 768 and 1440 pixels; three connection guides; keyboard-operated disclosure panels; valid internal page anchors; loaded local assets; privacy and feedback routes. The PowerShell configuration example passed syntax and mocked argument-boundary checks without running Claude or changing a real client configuration. The website archive and changed documents passed the targeted sensitive-data scan.

### Recorded runtime validation

The complete automated suite passed **573 tests**, with **two opt-in tests skipped** and zero failures. Browser/companion integration passed in Chromium and Microsoft Edge. The Edge check also used a real ChatGPT-authenticated Codex account to execute a read-only page tool and stream the actual page title, with no API key. No real X requests or posts were made; X actions and monitoring use local intercepted fixtures.

The installed Edge 152 browser does not expose the new native WebMCP consumer API. Its unavailable state and ordinary MCP fallback were verified; native discovery/execution contracts were tested against the documented API in an isolated harness. Do not interpret this as native WebMCP execution certified on Edge 152. Native site tools require a compatible browser/API and website.

Store-native permission dialogs, final publisher declarations and Edge store review remain manual release checks. The launcher is unsigned. Chat sign-in/model availability depends on the user's own current Codex installation and account; it is not an included subscription. The privacy documents remain drafts.

---

# ToolBraid 0.2.0 — initial public release candidate

Official release repository: [Maharajahu/toolbraid-releases](https://github.com/Maharajahu/toolbraid-releases).

The runtime reports version `0.2.0`; the GitHub release is tagged `v0.2.0-rc.1` and marked as a pre-release. Microsoft Edge Add-ons publication is pending. Chrome distribution uses downloaded ZIPs and manual unpacked installation, not the Chrome Web Store.

## Downloads

- `ToolBraid-0.2.0-windows-x64.zip` — complete Windows x64 companion, installer, bundled Node.js and matching extension.
- `ToolBraid-0.2.0-extension.zip` — extension only, for users with the matching companion.
- `SHA256SUMS.txt` — checksums for both ZIPs.

Use the release Assets section, not GitHub's automatically generated Source code archives. Follow the [installation guide](https://github.com/Maharajahu/toolbraid-releases/blob/main/INSTALL.md).

## Included

- MCP-compatible browser tooling with a Windows native companion.
- Site-specific opt-in and a visible pause control; control starts paused.
- Optional advanced browser tools and local workflow capabilities.
- Packaged X adapters for Post, Reply, Like, Repost and Quote; live X behavior is not yet certified.
- A bundled Node.js runtime, so users do not need a separate runtime or compiler.

## Validation already recorded for this runtime

On 12 September 2026, the local suite passed **554 tests**, with **2 opt-in tests skipped**. Isolated Chrome and Edge tests covered initial enable, MCP reads, exact local form submission, offline X fixture actions, enabled/paused restart states and pause blocking. Companion install, update and uninstall were validated separately.

The runtime files are unchanged from that prepared build. On 12 September 2026, the packages were repacked only to replace the public contact address in their privacy documents with the feedback form; SHA256SUMS.txt identifies the updated ZIPs. Publishing documentation or GitHub assets is not an additional live-browser validation.

## Known release-candidate limitations

- Clean-install native site-access and optional-debugger grant/decline dialogs still require manual validation; the automated harness pregrants its test permissions.
- X actions were tested against an offline fixture, not a real X account.
- The ToolBraid launcher is unsigned. Checksums do not establish publisher identity. Do not disable security protections to install it.
- Final publisher privacy declarations and Edge store review remain outstanding. The privacy documents are still drafts.
- Windows x64 with Chrome or Edge is the current target. Chrome and unpacked Edge updates are manual.
- No AI model, AI subscription or API credit is included. Data returned to a cloud AI client may reach its provider.

Website: [toolbraid.pages.dev](https://toolbraid.pages.dev/). Feedback and support: [Feedback form](https://toolbraid.pages.dev/feedback/). Do not attach secrets or private data to support reports.
