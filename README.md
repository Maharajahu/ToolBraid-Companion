<p align="center"><img src="assets/toolbraid.svg" width="88" height="88" alt="ToolBraid logo"></p>

<h1 align="center">ToolBraid</h1>

<p align="center"><strong>Browser and Windows tools for your AI assistant.</strong></p>
<p align="center">Read pages. Work with forms. Connect your assistant to the tools you choose.</p>

<p align="center">
  <a href="https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.2.0-rc.1"><img src="https://img.shields.io/badge/release-0.2.0_RC1-ffd278" alt="Release 0.2.0 RC1"></a>
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

ToolBraid connects an **MCP-compatible AI client** to your browser and Windows computer. A browser extension works with a local Windows companion so your assistant can read permitted pages, navigate tabs, fill fields and perform browser actions. The companion also exposes local file, desktop and job tools.

**It is a tool connection, not an AI model or a chatbot.** Your chosen AI client provides the reasoning and receives the results. An ordinary chatbot website does not gain ToolBraid access just because the extension is installed.

### What can you use it for?

| You ask your assistant to… | ToolBraid provides… |
| --- | --- |
| Summarize a page or compare information across open tabs | Page text, links and tab-navigation tools. Your AI writes the summary. |
| Work through a form on a site you allow | Field inspection, filling and browser actions, including submission. |
| Work with selected local files or a Windows application | Companion file tools and desktop accessibility controls. Availability depends on the application and granted access. |

These are example workflows, not a promise that every website or application is supported. Packaged X actions include Post, Reply, Like, Repost and Quote; automated checks use an **offline X fixture**, not a certified live account.

## See the interface

<p align="center">
  <img src="assets/sidepanel-paused.png" width="300" alt="Actual ToolBraid side panel: control starts paused and site access must be enabled.">
  <img src="assets/x-direct-control.png" width="300" alt="Actual ToolBraid action controls on an offline X test fixture.">
</p>

Actual release-candidate screenshots: **paused before opt-in** (left), **available X tools on a local test page** (right). The colorful banner is the original editorial artwork from the ToolBraid X article.

## Get started

1. **Download the complete Windows package** from [release 0.2.0 RC1](https://github.com/Maharajahu/toolbraid-releases/releases/tag/v0.2.0-rc.1). Extract it and run `Install.cmd` as your normal Windows user.
2. **Load the matching extension** using Developer mode → Load unpacked in Chrome or Edge. Select the included `extension` folder, not the ZIP.
3. **Connect your AI client** using the generated `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json`. An optional `Configure-Codex.cmd` helper is included for Codex.
4. **Choose a page and enable control** in the side panel. Read the disclosure and grant the site's browser permission. Start with: “Read this page's title and summarize its visible text. Do not click or submit anything.”

The [installation guide](INSTALL.md) covers exact setup, [connection troubleshooting](INSTALL.md#troubleshooting), updates and removal.

### Which download do I need?

| Release asset | Use it for |
| --- | --- |
| **`ToolBraid-0.2.0-windows-x64.zip`** | **A new installation.** Companion, bundled Node.js, installer and matching extension. |
| `ToolBraid-0.2.0-extension.zip` | Extension only; a matching installed Windows companion is still required. |
| `SHA256SUMS.txt` | Verify the downloaded ZIP bytes. |

Use the release's **Assets** section. GitHub's automatic **Source code** archives contain this documentation repository, **not the application installer**.

## Browser support

| Browser or client | Current status |
| --- | --- |
| **Microsoft Edge** | Planned official store channel. Edge Add-ons is **not published yet**; the RC can be loaded unpacked. |
| **Google Chrome** | Official ZIP downloads with manual installation and updates. No Chrome Web Store release is planned. |
| **Codex** | Optional MCP configuration helper is included. |
| **Other MCP clients** | Manual configuration required. Compatibility with every client is not established. |

Windows x64 is required. No separate Node.js installation, compiler, private source checkout or experimental WebMCP flag is needed. AI accounts, subscriptions, API usage and local models are separate. **Donating is never required to use ToolBraid.**

## Control and data boundaries

- **Starts paused.** Read the direct-control disclosure and explicitly enable the site.
- **Enabled means actions can execute.** Your connected AI can use available tools without another ToolBraid prompt for each action, including form submission. Your AI client may impose its own approvals.
- **Pause blocks new commands.** It cannot undo submitted actions or guarantee that existing companion jobs stop.
- **Local connection is not local-only AI.** Tool results go to your client. A cloud model provider may receive page content, file information or desktop results. Optional media analysis uses the endpoint you configure.
- **Trust the connected client.** The companion exposes more than browser reads. Grant only the site, file and advanced-tool access you intend to use.

Read the [data-handling page](https://toolbraid.pages.dev/privacy/) and packaged `PRIVACY.md`. The release-candidate privacy documents remain drafts pending final publisher review.

## Release status

**0.2.0 RC1 is a pre-release, not a stable or Microsoft-approved launch.** The [release notes](RELEASE-NOTES.md) distinguish recorded automated checks from outstanding manual validation and live-site limitations.

The ToolBraid launcher is currently unsigned. Windows may show an unknown-publisher warning. Do not disable antivirus or browser protections. Checksums identify bytes; they are not a publisher signature.

## Feedback and support

Use the [Feedback form](https://toolbraid.pages.dev/feedback/) for a bug, an idea or a privacy question. No account is required; your reply email is optional. Messages are not published as GitHub issues. Never send passwords, tokens, private page contents or personal documents.

[GitHub issues](https://github.com/Maharajahu/toolbraid-releases/issues) are also available, but **everything posted there is public**.

Follow development on [X](https://x.com/dandumt23), or [buy me a coffee](https://buymeacoffee.com/dumitrescup) if you would like to support the project. Support is entirely optional.

## Distribution and license

This is Maharajahu's **official public release repository**: documentation, presentation assets and packaged downloads. It is not the private development checkout or its Git history. Application packages contain the runtime files needed to use ToolBraid.

ToolBraid is distributed under the [Apache License 2.0](LICENSE). The Windows package also includes the bundled runtime's license at `runtime/LICENSE.node.txt`.
