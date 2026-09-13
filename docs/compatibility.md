# Compatibility and validation

[Overview](../README.md) · [Install](../INSTALL.md) · [Capabilities](capabilities.md)

Scope: **0.3.1 RC1, fixes refresh dated 13 September 2026**. The version number did not change; [SHA256SUMS.txt](../SHA256SUMS.txt) identifies the three refreshed ZIPs and the demo export.

## Browser and client compatibility

| Component | Requirement / coverage |
| --- | --- |
| Companion | Windows x64. Node.js is bundled in the complete Windows ZIP. |
| Extension | Manifest V3, Chrome or Edge; declared minimum Chromium 120. Manual unpacked installation. |
| Ordinary page tools | Do not require experimental WebMCP flags or attach the debugger for basic actions. |
| Native WebMCP | Requires a browser exposing the native consumer API and a site registering tools. Not guaranteed in every default Chrome/Edge version. |
| Built-in chat | Current local Codex and ChatGPT sign-in with Codex access. Real subscription-backed read-only Edge integration was exercised. |
| External MCP clients | Local stdio MCP support. Codex configuration helper included; other clients use their supported configuration format. |
| Claude Code / LM Studio | Documented setup paths, not end-to-end certified pairings. Local models also need reliable tool calling. |
| Visual analysis | Separately configured multimodal provider; account/endpoint requirements depend on that provider. |
| Local media editing | Separate FFmpeg installation. Codec/container availability depends on the installed build. |

The unpacked Chrome/Edge extension identity is `gpjhdlbjfhlaeakphfognpijgmclecmn`. The assigned Edge Add-ons identity is `ailfkkdmjppafngmkobpiogoamidipcl`; it is a separate distribution identity. A keyless publisher ZIP must not be substituted for the stable-key unpacked extension.

## Distribution and signing

The public downloads are a **pre-release candidate**, not a stable or Microsoft-approved release. The Windows ZIP launcher is unsigned. A matching checksum confirms integrity, not publisher identity; do not disable security protections.

**Last recorded publisher status, 13 September 2026:** Windows Companion 0.3.1.0 was **In certification**, and the separate Edge Add-ons extension was **In review**. Submission is not approval. No verified public Store installation links are listed here. Microsoft signing of a certified MSIX will not sign the independent ZIP/EXE.

Store installation/update/removal still needs validation after availability. Chrome distribution uses manual ZIP installation and updates. Refreshing assets on GitHub does not change an existing Microsoft submission.

## Permissions and data

- **Control starts paused.** Read the disclosure, enable the intended site and grant browser site access.
- **External MCP direct control can execute actions**, including submissions, without a second ToolBraid prompt for each one. The external client can impose its own approvals.
- **Panel chat has separate mutation approvals.** Page sharing starts off and each browser change needs approval. This does not alter external-client behavior.
- **Debugger is an install-time permission** in the refreshed extension, not a separate optional button. Screenshots, browser accessibility inspection and file attachment use it when required; basic page tools do not attach it.
- **Local resources require grants.** File/folder and desktop tools are distinct from page reading. Connect only clients you trust.
- **Pause blocks new browser commands.** It cannot undo completed actions or guarantee cancellation of already-running companion jobs. Cancel jobs explicitly where supported.
- **Local transport does not imply local-only AI.** Results may reach the selected cloud model or configured media provider. Clearing local history does not erase provider records.

The [privacy policy](https://toolbraid.pages.dev/privacy/) documents retention and transfers. The optional support links open external sites; donating is not required and does not unlock features.

## Recorded validation

These are previously recorded **application** results for the release, not tests rerun by this documentation repository's CI.

| Check | Recorded result | Boundary |
| --- | --- | --- |
| Automated suite, 13 September | **616 passed, 4 opt-in skipped, 0 failed** | Not every integration is a live-site test. |
| MCP server tests | **8/8 passed** | Configuration refresh, authenticated reconnect, concurrency and no replay of interrupted commands. Included in the total above. |
| Browser integration | Chromium/Edge checks and required-debugger panel state | Clean-install native permission dialogs and all re-enablement paths still need manual checks. |
| ChatGPT panel chat | Real account-backed read-only browser call and streamed result in Edge | Does not certify every account, model or provider combination. |
| Native WebMCP | Real API discovery/execution on an isolated localhost page in Chromium 151 with its experimental flag | Not certification of the entire native extension-to-MCP pipeline or default Edge availability. |
| X | Live rendered-page reading and explicitly authorized replies; fixture coverage for broader actions | Media and article drafts are not fully live-certified; site changes can affect adapters. |
| Store companion | Diagnostic/launcher and isolated registration checks | Not proof of Store-installed lifecycle behavior or Microsoft approval. |

Schedules require an active runner to invoke due-work ticks. Monitoring requires an open browser and selected watched tab. Neither is a promise of unattended, always-on cloud automation.

## Demo and screenshot provenance

The demo contains real Windows browser capture, actual model responses, a live website/public X conversation, an unsent reply draft and approved GitHub navigation. It is edited for pace with zooms and captions. The full timeline is approximately **1 minute 23 seconds**, with **no audio**. The browser recording shows the 0.3.0 interface.

The website/GitHub player is **1080p**. The downloadable **3840 × 2160** export is reframed/upscaled from the Windows capture, not native 4K acquisition. [Watch and read the video description](https://toolbraid.pages.dev/#demo).

The paired **0.3.1 UI previews** use offline data. The chat view replays a recorded read-only exchange; it is not a fresh account test. The [original Edge chat capture](../assets/chat-subscription.png) is retained for reference. Preview images do not imply live posting or certification of every visible control.
