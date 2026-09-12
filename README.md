<p align="center"><img src="assets/toolbraid.svg" width="88" height="88" alt="ToolBraid logo"></p>

<h1 align="center">ToolBraid</h1>

<p align="center"><strong>WebMCP-enabled browser tools. An agent beside your work.</strong></p>
<p align="center">Stay connected to your community. Stay focused on building.</p>

<p align="center">
  <a href="https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.3.0-rc.1"><img src="https://img.shields.io/badge/release-0.3.0_RC1-ffd278" alt="Release 0.3.0 RC1"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-77e7f4" alt="Apache License 2.0"></a>
  <a href="INSTALL.md"><img src="https://img.shields.io/badge/platform-Windows_x64-303743" alt="Windows x64"></a>
  <a href="#browser-support"><img src="https://img.shields.io/badge/Chrome-manual_install-77e7f4" alt="Chrome manual installation"></a>
  <a href="#browser-support"><img src="https://img.shields.io/badge/Edge-store_pending-ffd278" alt="Edge store publication pending"></a>
</p>

<p align="center">
  <a href="https://toolbraid.pages.dev/"><strong>Website</strong></a> ·
  <a href="#what-is-toolbraid">What it does</a> ·
  <a href="#see-the-interface">Screenshots</a> ·
  <a href="INSTALL.md">Install</a> ·
  <a href="RELEASE-NOTES.md">Release notes</a> ·
  <a href="https://toolbraid.pages.dev/feedback/">Feedback form</a>
</p>

<p align="center">Built by <a href="https://github.com/Maharajahu">Maharajahu</a> · Free to download · Bring your own AI client</p>
<p align="center">
  <a href="https://x.com/dandumt23"><img src="https://img.shields.io/badge/Follow-%40dandumt23-111111?style=for-the-badge&amp;logo=x&amp;logoColor=white" alt="Follow @dandumt23 on X"></a>
  <a href="https://buymeacoffee.com/dumitrescup"><img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?style=for-the-badge&amp;logo=buymeacoffee&amp;logoColor=000000" alt="Buy me a coffee — optional support"></a>
</p>

<p align="center"><img src="assets/toolbraid-cover.png" width="1100" alt="ToolBraid: From intent to evidence. Cyan and pink strands connect across a dark background."></p>

## What is ToolBraid?

ToolBraid is a **WebMCP-enabled browser extension with integrated agent chat**, backed by a local Windows companion. Chat uses your **ChatGPT account through official Codex App Server**, with your account's Codex limits: no API key and no separately billed model API for the integrated chat. It streams responses, keeps recent conversation history locally, and can use the connected page's tools when you choose to share them.

On compatible sites and browsers, ToolBraid discovers and executes **site-registered native WebMCP tools**. Existing page extraction and MCP tools work independently when the native browser API is unavailable. The companion also connects external MCP clients to browser, local-file, desktop and job tools. No model or new subscription is bundled; installing the extension does not give an unrelated chatbot website automatic browser access.

### Built for developers and their communities

Keep working on your projects without constantly switching to X. ToolBraid can inspect the currently rendered mentions or replies on your selected X page, return exact post links, and help your agent suggest what deserves attention. Ask for a catch-up, draft a reply in your own voice, or explicitly tell the agent what to send. The integrated chat asks for approval before changes; it does not send automatic replies or DMs.

Optional quiet monitoring watches one dedicated notifications/conversation tab while the browser is open. It checks at your chosen interval, keeps a local inbox, and can notify you about newly observed posts without message previews. It does not call a model or consume Codex usage while monitoring. It pauses on account/page changes or revoked access. This is rendered-page inspection, not a complete account archive or a claim to see every reply.

### What can you use it for?

| You ask your assistant to… | ToolBraid provides… |
| --- | --- |
| Chat with an agent beside the page | Streaming Codex chat through ChatGPT sign-in, recent local history, Stop and exact mutation approvals. |
| Use a compatible site's own agent tools | Native WebMCP discovery and one-use page/frame-bound execution handles. Browser API availability is required. |
| Catch up with my X community without losing project focus | Visible mentions/replies with links, catch-up prompts, reply drafts and optional quiet monitoring. |
| Summarize a page or compare information across open tabs | Page text, links and tab-navigation tools. Your AI writes the summary. |
| Work through a form on a site you allow | Field inspection, filling and browser actions, including submission. |
| Work with selected local files or a Windows application | Companion file tools and desktop accessibility controls. Availability depends on the application and granted access. |

These are example workflows, not a promise that every website or application is supported. Packaged X actions include Post, Reply, Like, Repost and Quote; automated checks use an **offline X fixture**, not a certified live account.

## See the interface

<p align="center">
  <img src="assets/chat-subscription.png" width="300" alt="Actual integrated chat in Microsoft Edge, using a ChatGPT account to read a local test page.">
  <img src="assets/x-direct-control.png" width="300" alt="Actual ToolBraid action controls on an offline X test fixture.">
</p>

Actual release-candidate screenshots: **subscription-backed chat in Edge reading a local test page** (left), **available X tools on a local test page** (right). The colorful banner is the original editorial artwork from the ToolBraid X article.

## Get started

1. **Download the complete Windows package** from [release 0.3.0 RC1](https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.3.0-rc.1). Extract it and run `Install.cmd` as your normal Windows user.
2. **Load the matching extension** using Developer mode → Load unpacked in Chrome or Edge. Select the included `extension` folder, not the ZIP.
3. **Use your ChatGPT account in the chat panel.** Install a current Codex CLI or desktop app, enable ToolBraid and choose **Sign in with ChatGPT**, then **Connect to Codex**. External MCP clients can still use the generated `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json`; the optional `Configure-Codex.cmd` helper is for that separate integration.
4. **Choose a page and enable control** in the side panel. Read the disclosure and grant the site's browser permission. Start with: “Read this page's title and summarize its visible text. Do not click or submit anything.”

The [installation guide](INSTALL.md) covers exact setup, [connection troubleshooting](INSTALL.md#troubleshooting), updates and removal.

### Which download do I need?

| Release asset | Use it for |
| --- | --- |
| **`ToolBraid-0.3.0-windows-x64.zip`** | **A new installation.** Companion, bundled Node.js, installer and matching extension. |
| `ToolBraid-0.3.0-extension.zip` | Extension only; a matching installed Windows companion is still required. |
| `SHA256SUMS.txt` | Verify the downloaded ZIP bytes. |

Use the release's **Assets** section. GitHub's automatic **Source code** archives contain this documentation repository, **not the application installer**.

## Browser support

| Browser or client | Current status |
| --- | --- |
| **Microsoft Edge** | Planned official store channel. Edge Add-ons is **not published yet**; the RC can be loaded unpacked. |
| **Google Chrome** | Official ZIP downloads with manual installation and updates. No Chrome Web Store release is planned. |
| **Codex / ChatGPT account** | Integrated streaming chat through official App Server; ChatGPT sign-in only. External MCP helper also included. |
| **Other MCP clients** | Manual configuration required. Compatibility with every client is not established. |

Windows x64 is required. The companion includes Node.js; no compiler or private source checkout is needed. Ordinary browser/MCP tools work without experimental flags. Native site WebMCP tools require the browser's native API; availability varies. Integrated chat requires a current Codex installation and your own ChatGPT account with Codex access. **Donating is never required to use ToolBraid.**

## Control and data boundaries

- **Starts paused.** Read the direct-control disclosure and explicitly enable the site.
- **Enabled means actions can execute.** Your connected AI can use available tools without another ToolBraid prompt for each action, including form submission. Your AI client may impose its own approvals.
- **Integrated chat has its own approvals.** Each browser mutation is reviewed before dispatch, and a run stays on its selected tab when you switch tabs. This does not change external MCP direct-control behavior.
- **Chat uses your subscription, not an API key.** ChatGPT sign-in is required; the provider receives messages and selected page/tool context. Recent history is stored locally and can be cleared. Clearing local history does not remove provider-side records.
- **Pause blocks new commands.** It cannot undo submitted actions or guarantee that existing companion jobs stop.
- **Local connection is not local-only AI.** Tool results go to your client. A cloud model provider may receive page content, file information or desktop results. Optional media analysis uses the endpoint you configure.
- **Trust the connected client.** The companion exposes more than browser reads. Grant only the site, file and advanced-tool access you intend to use.

Read the [data-handling page](https://toolbraid.pages.dev/privacy/) and packaged `PRIVACY.md`. The release-candidate privacy documents remain drafts pending final publisher review.

## Release status

**0.3.0 RC1 is a public pre-release candidate, not a stable or Microsoft-approved launch.** The [release notes](RELEASE-NOTES.md) distinguish recorded automated checks from outstanding manual validation and live-site limitations.

The ToolBraid launcher is currently unsigned. Windows may show an unknown-publisher warning. Do not disable antivirus or browser protections. Checksums identify bytes; they are not a publisher signature.

## Feedback and support

Use the [Feedback form](https://toolbraid.pages.dev/feedback/) for a bug, an idea or a privacy question. No account is required; your reply email is optional. Messages are not published as GitHub issues. Never send passwords, tokens, private page contents or personal documents.

[GitHub issues](https://github.com/Maharajahu/toolbraid-releases/issues) are also available, but **everything posted there is public**.

Follow development on [X](https://x.com/dandumt23), or [buy me a coffee](https://buymeacoffee.com/dumitrescup) if you would like to support the project. Support is entirely optional.

## Distribution and license

This is Maharajahu's **official public release repository**: documentation, presentation assets and packaged downloads. It is not the private development checkout or its Git history. Application packages contain the runtime files needed to use ToolBraid.

ToolBraid is distributed under the [Apache License 2.0](LICENSE). The Windows package also includes the bundled runtime's license at `runtime/LICENSE.node.txt`.
