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
