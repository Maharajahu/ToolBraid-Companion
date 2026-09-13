# ToolBraid store submission draft

Edge Add-ons draft created; the corrected 0.3.1 Edge package passed upload validation on 13 September 2026. It has not been submitted for certification or published. Chrome uses manual ZIP installation, not a Chrome Web Store submission. Public opt-in and pause controls are implemented. Before certification, finish the publisher requirements below and manually verify the browser's native optional-permission dialogs on a clean installation.

## Listing copy

Name: ToolBraid

Short description: WebMCP-enabled browser tools, ChatGPT-account chat through Codex, and X community workflows for developers.

Single purpose: Connect a user-configured AI client to the user's selected browser workflows through local, page-bound tools.

ToolBraid discovers tools from browser pages and exposes them to an MCP-compatible AI client. Use the side panel to grant site access, enable direct AI control, inspect tools and execution records, or pause new commands. Control starts paused; after opt-in, the AI can act without repeated approval, including submitting forms. A separate Windows x64 companion connects the extension to your chosen client. Native WebMCP is used when available, with an extension/MCP path otherwise. No experimental WebMCP flags are required.

An AI account or local model is not included. The extension does not supply an AI subscription. Optional media analysis uses the endpoint you configure. Chrome and Edge on Windows are the initial browser targets; other platforms and browsers are not claimed as validated.

Verified X page tools support preparing and publishing posts or replies, Like, Repost and Quote. Once X control is enabled, these actions do not show repeated ToolBraid approval prompts. Exact page and target checks still apply, and the AI client may apply its own confirmation rules. Pause blocks new extension commands, not actions already sent to a website.

## Permission justification

New in 0.3.0: streaming chat in the side panel using ChatGPT sign-in through official Codex App Server. No API key or separate API billing is supported for this chat; it uses the account's Codex limits. The integrated chat asks before browser mutations and remains bound to the selected tab. A current Codex installation and the Windows companion are required.

ToolBraid is WebMCP enabled: compatible sites can expose their native tools for discovery and execution. Native site tools depend on browser API availability. The ordinary extension/MCP path remains usable without that API; this fallback does not simulate a site's native tools.

Built for developers who want to stay connected to their X community without losing focus: inspect visible mentions/replies with links, request a catch-up or draft, and send only what you choose. Optional quiet monitoring reads one explicitly watched tab while Edge is open, without model calls or automated replies. It is not a full account archive or a DM reader. X functionality is validated on local fixtures, not certified against all live X account states.

| Permission | Purpose |
| --- | --- |
| activeTab | Operate on a page after the user invokes the extension. |
| scripting | Run the bundled page extractor and action executor on permitted pages. |
| storage | Keep local settings, records and workflow state. |
| sidePanel | Show page tools, context, actions and controls. |
| tabs | Identify and manage the browser tabs involved in a requested workflow. |
| downloads | Inspect requested downloads and associate completed files with local file grants. |
| nativeMessaging | Connect to the installed Windows companion. |
| alarms | Run explicitly enabled community checks while the browser is available. |
| notifications (optional) | Show generic counts of newly observed X posts when the user requests notifications. |
| debugger | Provide requested precise visual clicks, accessibility inspection and file attachment. Chrome requires declaration at installation; AI-control and site-access checks still apply. |
| HTTPS / localhost hosts (optional) | Access the sites the user permits and an optional user-configured AI endpoint. |

## Privacy-dashboard draft

Local processing must still be disclosed. The publisher must review these proposed categories against the submitted feature set and the dashboard's current definitions; these are not submitted attestations. The reasons below describe what can be handled, not a claim that every category is collected on every visit.

| Data category | Basis for disclosure |
| --- | --- |
| Website content | Page text, forms, links, selected media, screenshots and requested tool results. |
| Web history | URLs, titles and navigation context of pages involved in enabled workflows; no browser-history API permission is requested. |
| User activity | Tool actions, approval/audit records and saved workflow state. |
| Personally identifiable information | Names, account details and similar content when present on permitted pages or in selected files. |
| Personal communications | Messages or correspondence when the user enables workflows on pages containing them. |
| Authentication information | User-entered AI API credentials and local companion authentication configuration; the ordinary form extractor excludes password-field values. |
| Financial and payment information | May appear in permitted page text, files or screenshots despite recognized payment-field values being omitted by the form extractor. |
| Health information | May appear on pages or in files the user chooses to process. |
| Location | May appear in permitted content; the extension does not request a geolocation permission. |

Remote code draft answer: **No** for the bundled extension code. Page extraction, execution and adapters are packaged with the extension; the configured AI endpoint returns data, not downloaded extension code. Native WebMCP tools belong to the visited website. Explain the separate Windows native companion in reviewer notes rather than concealing it. Recheck this answer if the distribution changes.

The publisher, not this draft, must make the data-use certifications. `PRIVACY.md` records the actual local data flow and a proposed Limited Use policy; confirm publisher support and hosting practices before publishing it. Official references: [privacy dashboard](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

## Store artwork

The following files in `release/store-assets` are copied into `assets` in the submission kit. They are generated from the existing logo and actual side-panel captures. The X screenshot explicitly identifies its offline fixture; it is not evidence of a live account action.

| File | Dimensions | Intended field |
| --- | --- | --- |
| `01-connect-your-ai.jpg` | 1280 x 800 | Screenshot 1, Chrome or Edge |
| `02-x-direct-control.jpg` | 1280 x 800 | Screenshot 2, Chrome or Edge |
| `promo-small-440x280.jpg` | 440 x 280 | Small promotional tile |
| `logo-128.png` | 128 x 128 | Chrome store logo, with 96 x 96 artwork |
| `logo-300.png` | 300 x 300 | Edge store logo |

Dimensions, image decoding, text bounds and rendering were verified locally. Sources: [Chrome image requirements](https://developer.chrome.com/docs/webstore/images) and [Edge submission fields](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

## Public support and privacy contact

[Feedback form](https://toolbraid.pages.dev/feedback/)

The extension also links to the official GitHub project and optional developer support on Buy Me a Coffee. ToolBraid remains free; support does not unlock features. Payments take place on Buy Me a Coffee, not inside the extension, and are not sponsored by Microsoft.

## Submission requirements still to supply

- The Edge publisher account is available and a draft exists. The selected Microsoft route is free; no certificate purchase is authorized.
- Public privacy-policy URL: https://toolbraid.pages.dev/privacy/. Confirm its contents match the submitted build; do not declare that no user data is processed merely because the bridge runs locally.
- Publisher confirmation of the privacy categories and data-use certifications drafted above.
- Stable companion download URL and reviewer instructions for installing it without access to the private source repository.
- Actual Edge Add-ons CRX ID: `ailfkkdmjppafngmkobpiogoamidipcl` (Edge Store ID `0RDCKG19W71L`). The real-identity MSIX allowlist uses this ID plus the matching Chrome unpacked ID. Do not treat the draft Store ID as a published download link.

## Reviewer test path

Use the complete instructions in `REVIEWER-INSTRUCTIONS.md`, including clean installation, grant/decline of native permission dialogs, a real MCP workflow, pause/restart and removal. Supply a working companion download and the actual store ID before sending those instructions to reviewers.

## Local verification

On 12 September 2026, Chrome 152.0.7977.76 and Edge 152.0.4191.66 passed real MCP reads and an exact-argument local form submission, fresh-profile opt-in, enabled-state restart, pause blocking page and desktop requests, and paused-state restart. Both also passed Like, Repost, Quote and Post without per-action ToolBraid confirmation against an offline X fixture, with exact target/text checks and no live X requests. No WebMCP flags were used; both browsers used the extension/MCP transport. The test harness pregrants its local fixture host, the fully intercepted X fixture origin, and debugger access for controlling the real side panel. Native permission dialogs still require a manual clean-install check; these tests do not certify that dialog flow or live X account behavior. The full local suite passed 554 tests with 2 opt-in integration tests skipped in that run.

## Build locally

```powershell
node scripts/build-universal-extension.mjs --edition public
node scripts/build-store-assets.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -IncludeSubmissionKit
```

Both extension ZIPs have `manifest.json` at their root and exclude developer-path build metadata. Upload the `edge-extension.zip` variant to Edge Add-ons; it omits the manifest `key` rejected by Microsoft. The ordinary `extension.zip` retains that public key for Chrome's stable unpacked ID. The companion ZIP bundles the runtime and installer. The submission kit contains both extension ZIPs, artwork and reviewer/publisher documents, not the private repository. The artwork builder requires the captured `store-assets/raw` images; the ordinary release build does not. No command above publishes anything.
