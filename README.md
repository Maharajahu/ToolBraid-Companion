<p align="center"><img src="assets/toolbraid.svg" width="88" height="88" alt="ToolBraid logo"></p>

<h1 align="center">ToolBraid</h1>

<p align="center"><strong>WebMCP-enabled browser tools. An agent beside your work.</strong></p>
<p align="center">Stay connected to your community. Stay focused on building.</p>

<p align="center">
  <a href="https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.3.1-rc.1"><img src="https://img.shields.io/badge/release-0.3.1_RC1-ffd278" alt="Release 0.3.1 RC1"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-77e7f4" alt="Apache License 2.0"></a>
  <a href="INSTALL.md"><img src="https://img.shields.io/badge/platform-Windows_x64-303743" alt="Windows x64"></a>
  <a href="#browser-support"><img src="https://img.shields.io/badge/Chrome-manual_install-77e7f4" alt="Chrome manual installation"></a>
  <a href="#browser-support"><img src="https://img.shields.io/badge/Edge-in_review-ffd278" alt="Edge Add-ons submission in review; not yet published"></a>
</p>

<p align="center">
  <a href="https://toolbraid.pages.dev/"><strong>Website</strong></a> ·
  <a href="#what-is-toolbraid">What it does</a> ·
  <a href="#watch-the-real-windows-demo">Real demo</a> ·
  <a href="#see-the-interface">Screenshots</a> ·
  <a href="INSTALL.md">Install</a> ·
  <a href="#choose-your-ai">Choose your AI</a> ·
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

ToolBraid is a **WebMCP-enabled browser extension with optional integrated agent chat**, backed by a local Windows companion. The built-in chat uses your **ChatGPT account through official Codex App Server**, with your account's Codex limits: no API key and no separately billed model API for that chat. It streams responses, keeps recent conversation history locally, and can use the connected page's tools when you choose to share them. **ChatGPT and Codex are not required when you use ToolBraid only through another MCP client.**

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

## Watch the real Windows demo

[![Play ToolBraid on real websites in Microsoft Edge on Windows](assets/toolbraid-demo-poster.jpg)](https://toolbraid.pages.dev/#demo)

**[Watch on the website](https://toolbraid.pages.dev/#demo)** · [Download the 4K export](https://github.com/Maharajahu/toolbraid-releases/releases/download/v0.3.1-rc.1/ToolBraid-Windows-real-demo-4K.mp4)

Actual model responses, a live website and public X conversation, a reply draft, and GitHub navigation after approval. No voice or live X post. Shortened waits, zooms and captions are editorial edits; the browser UI is a real Windows capture. The 4K file is an upscaled/reframed export; the website uses a lighter 1080p copy.

**You do not have to use the built-in chat.** Keep talking in your existing Codex session and connect ToolBraid as an MCP server.

## See the interface

High-resolution captures of the public **0.3.1 interface**, including the optional **Buy me a coffee** and **GitHub** footer. Rendered at **125% zoom and 3× pixel density (1440 pixels wide)** with offline preview data. On a phone, select either image to read it at full resolution.

<table>
  <tr><th width="50%">Agent chat</th><th width="50%">X community</th></tr>
  <tr>
    <td width="50%" valign="top"><a href="assets/chat-subscription-hd.png"><img src="assets/chat-subscription-hd.png" width="480" alt="ToolBraid 0.3.1 chat preview with the recorded read-only exchange and optional support footer."></a></td>
    <td width="50%" valign="top"><a href="assets/x-direct-control-hd.png"><img src="assets/x-direct-control-hd.png" width="480" alt="ToolBraid 0.3.1 X community and native WebMCP controls with the optional support footer; offline preview."></a></td>
  </tr>
  <tr>
    <td valign="top">Optional chat beside your work.<br><a href="assets/chat-subscription-hd.png">Enlarge chat ↗</a></td>
    <td valign="top">Community and site tools.<br><a href="assets/x-direct-control-hd.png">Enlarge X panel ↗</a></td>
  </tr>
</table>

The chat preview replays the previously recorded subscription-backed read-only exchange; it is **not a new live account check**. [Original Edge test capture](assets/chat-subscription.png). The community view uses **offline preview data; no live X actions were performed**. The packaged interface and controls are unchanged by these captures.

The colorful banner is the original editorial artwork from the ToolBraid X article.

## Get started

1. **Download the complete Windows package** from [release 0.3.1 RC1](https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.3.1-rc.1). Extract it and run `Install.cmd` as your normal Windows user.
2. **Load the matching extension** using Developer mode → Load unpacked in Chrome or Edge. Select the included `extension` folder, not the ZIP.
3. **Choose a page and enable control** in the side panel. Read the disclosure and grant the site's browser permission.
4. **Choose your AI below.** Use the optional built-in ChatGPT chat, your existing MCP client, or a local model in a compatible external client. Start with: “Read this page's title and summarize its visible text. Do not click or submit anything.”

The [installation guide](INSTALL.md) covers exact setup, [connection troubleshooting](INSTALL.md#troubleshooting), updates and removal.

## Choose your AI

Choose **one** route. The built-in chat is optional.

### ChatGPT in the side panel

Chat beside the page using **Connection & model**. Install current Codex on this PC and sign in with your own ChatGPT account with Codex access. **No API key**; your account's Codex limits apply.

[Set up ChatGPT chat →](INSTALL.md#option-a-chatgpt-in-the-toolbraid-panel) · A real subscription-backed read-only browser check passed in Edge.

### Your existing Codex session or another MCP client

Keep the conversation and model selection **in your existing client**. Add ToolBraid's local MCP server there. For another provider, use its supported client and sign-in route; a subscription alone does not connect that provider to ToolBraid.

[Set up an external client →](INSTALL.md#option-b-an-external-mcp-client) · Includes Codex and a Claude Code example. Claude Code pairing requires manual setup and has not been end-to-end certified.

### A model running locally

Use a tool-capable model in an MCP-capable client such as **LM Studio**. Load a model that fits your machine, then add ToolBraid in that client's MCP settings. **No ChatGPT account is needed** for this route.

[Set up a local model →](INSTALL.md#option-c-a-local-model-in-lm-studio) · LM Studio instructions are documentation-based; model/client combinations have not been end-to-end certified.

**There is no “connect any subscription” button, Ollama endpoint field or LM Studio model selector in the built-in chat.** Other providers and local models stay in their own client. A subscription does not automatically include API access or grant arbitrary third-party integrations; the provider's supported sign-in route and limits apply. [OpenAI explains subscription sign-in versus API billing](https://learn.chatgpt.com/docs/auth).

For the built-in route: open **Your browser agent → Connection & model → Sign in with ChatGPT**, complete the official login, choose **Connect to Codex**, then choose an offered **Codex model** or leave **Account default**. Page sharing starts off. `Configure-Codex.cmd` and `mcp-client.json` are for the separate external-client route, not prerequisites for built-in chat.

With a local model, inference can stay on your PC; browser requests, submitted actions, other enabled MCP servers and any separately configured cloud/media endpoint may still send data out. Local transport alone is not an offline/privacy guarantee. See [data handling](https://toolbraid.pages.dev/privacy/).

### Which download do I need?

- **[Windows package — start here](https://github.com/Maharajahu/toolbraid-releases/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-windows-x64.zip):** companion, bundled Node.js, installer and matching extension for a new installation.
- **[Extension only — manual installation](https://github.com/Maharajahu/toolbraid-releases/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-extension.zip):** for Chrome or unpacked Edge; requires the matching installed Windows companion.
- **Edge submission package:** `ToolBraid-0.3.1-edge-extension.zip` is the keyless package prepared for **Edge Add-ons submission**, not the manual-install download. Loading it unpacked produces a different extension identity and may not connect to the companion. Use one of the downloads above until the Store listing is published.
- **[SHA256SUMS.txt](https://github.com/Maharajahu/toolbraid-releases/releases/download/v0.3.1-rc.1/SHA256SUMS.txt):** verifies the three published ZIPs and the 4K demo. The [repository copy](SHA256SUMS.txt) contains the same checksums.

Use the release's **Assets** section. GitHub's automatic **Source code** archives contain this documentation repository, **not the application installer**.

## Browser support

| Browser or client | Current status |
| --- | --- |
| **Microsoft Edge** | Submitted to Edge Add-ons on **13 September 2026**; last confirmed status **In review**. Not yet published. Use the ordinary extension ZIP for unpacked installation. |
| **Google Chrome** | Official ZIP downloads with manual installation and updates. No Chrome Web Store release is planned. |
| **Codex / ChatGPT account** | Integrated streaming chat through official App Server; ChatGPT sign-in only. External MCP helper also included. |
| **Other MCP clients** | Manual configuration required. Compatibility with every client is not established. |

Windows x64 is required. The companion includes Node.js; no compiler or private source checkout is needed. Ordinary browser/MCP tools work without experimental flags. Native site WebMCP tools require the browser's native API; availability varies. Integrated chat requires a current Codex installation and your own ChatGPT account with Codex access. **Donating is never required to use ToolBraid.**

<a id="microsoft-store-companion--in-preparation"></a>

## Microsoft Store companion — in certification

**Submitted on 13 September 2026:** Microsoft Partner Center confirmed **In certification** for ToolBraid Companion 0.3.1.0. Free publication is scheduled after approval. This Windows application is separate from the browser extension's **Edge Add-ons** listing. Neither submission nor upload validation means approval or a public Store download. Store-installed lifecycle testing is not claimed; local validation MSIX files are not intended for distribution.

The prepared native app provides **Connect browsers**, **Disconnect browsers**, **Open MCP configuration** and **Check connection**. Diagnostics distinguish runtime/configuration, MCP handshake, extension connection and selected page without browser actions or model requests. Reports omit URLs/titles, credentials, paths and raw errors; AI sign-in is not tested. This window belongs to the upcoming Store companion, not the ZIP installer.

The extension remains separate. Chat stays optional, including use from your existing Codex session. Disconnect browser registrations before uninstalling the Store app; local data is retained. Microsoft signing of a certified MSIX will not sign the independent ZIP/EXE. [Store setup and current limits](INSTALL.md#microsoft-store-companion--in-preparation).

## Control and data boundaries

- **Starts paused.** Read the direct-control disclosure and explicitly enable the site.
- **Enabled means actions can execute.** Your connected AI can use available tools without another ToolBraid prompt for each action, including form submission. Your AI client may impose its own approvals.
- **Integrated chat has its own approvals.** Each browser mutation is reviewed before dispatch, and a run stays on its selected tab when you switch tabs. This does not change external MCP direct-control behavior.
- **Chat uses your subscription, not an API key.** ChatGPT sign-in is required; the provider receives messages and selected page/tool context. Recent history is stored locally and can be cleared. Clearing local history does not remove provider-side records.
- **Pause blocks new commands.** It cannot undo submitted actions or guarantee that existing companion jobs stop.
- **Local connection is not local-only AI.** Tool results go to your client. A cloud model provider may receive page content, file information or desktop results. Optional media analysis uses the endpoint you configure.
- **Trust the connected client.** The companion exposes more than browser reads. Grant only the site, file and advanced-tool access you intend to use.

Read the [data-handling policy](https://toolbraid.pages.dev/privacy/) and packaged `PRIVACY.md` for local retention, provider transfers and optional external support links.

## Release status

**0.3.1 RC1 is a public pre-release candidate, not a stable or Microsoft-approved launch.** The [release notes](RELEASE-NOTES.md) distinguish recorded automated checks from outstanding manual validation and live-site limitations.

The ToolBraid launcher is currently unsigned. Windows may show an unknown-publisher warning. Do not disable antivirus or browser protections. Checksums identify bytes; they are not a publisher signature.

## Feedback and support

The extension includes a compact footer with **Buy me a coffee** and a **GitHub icon**. Support is optional and does not unlock features. Both links open a separate tab; payment is handled by Buy Me a Coffee, not by the extension. No embedded payment form, tracking script or new browser permission is added.

Use the [Feedback form](https://toolbraid.pages.dev/feedback/) for a bug, an idea or a privacy question. No account is required; your reply email is optional. Messages are not published as GitHub issues. Never send passwords, tokens, private page contents or personal documents.

[GitHub issues](https://github.com/Maharajahu/toolbraid-releases/issues) are also available, but **everything posted there is public**.

Follow development on [X](https://x.com/dandumt23), or [buy me a coffee](https://buymeacoffee.com/dumitrescup) if you would like to support the project. Support is entirely optional.

## Distribution and license

This is Maharajahu's **official public release repository**: documentation, presentation assets and packaged downloads. It is not the private development checkout or its Git history. Application packages contain the runtime files needed to use ToolBraid.

ToolBraid is distributed under the [Apache License 2.0](LICENSE). The Windows package also includes the bundled runtime's license at `runtime/LICENSE.node.txt`.
