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
