<p align="center"><img src="assets/toolbraid-logo.png" width="72" height="72" alt="ToolBraid logo"></p>

<h1 align="center">ToolBraid Companion</h1>

<p align="center">Your AI's connection to the browser, Windows and the work between them.</p>

<p align="center">
  <a href="https://apps.microsoft.com/detail/9P7VF25K2X1R"><img src="https://img.shields.io/badge/Microsoft_Store-Available-77e7f4" alt="Available on Microsoft Store"></a>
  <a href="https://github.com/Maharajahu/ToolBraid-Companion/releases/tag/v0.3.1-rc.1"><img src="https://img.shields.io/badge/manual_release-0.3.1_RC1-ffd278" alt="Manual release 0.3.1 RC1"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-77e7f4" alt="Apache License 2.0"></a>
  <a href="https://github.com/Maharajahu/ToolBraid-Companion/actions/workflows/docs.yml"><img src="https://github.com/Maharajahu/ToolBraid-Companion/actions/workflows/docs.yml/badge.svg" alt="Source and documentation checks"></a>
</p>

<p align="center">
  <a href="https://toolbraid.pages.dev/">Website</a> ·
  <a href="INSTALL.md">Install</a> ·
  <a href="docs/capabilities.md">Full specs</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/development.md">Build from source</a> ·
  <a href="RELEASE-NOTES.md">What's new</a>
</p>

<p align="center">
  <a href="https://x.com/ToolBraidComp"><img src="https://img.shields.io/badge/Follow-%40ToolBraidComp-111111?logo=x&amp;logoColor=white" alt="Follow @ToolBraidComp on X"></a>
  <a href="https://buymeacoffee.com/dumitrescup"><img src="https://img.shields.io/badge/Buy_me_a_coffee-FFDD00?logo=buymeacoffee&amp;logoColor=000000" alt="Buy me a coffee — optional support"></a>
</p>

ToolBraid combines a **WebMCP-enabled browser extension** and a **local Windows companion**. Connect it to your existing Codex session or another MCP client, or use the optional ChatGPT side-panel chat. Your assistant can work with real pages, desktop controls, approved files and repeatable workflows.

This is the official **source, releases and documentation repository** for the public edition. The browser extension, Windows companion, tests and packaging scripts are available under Apache 2.0.

**Updated 26 September 2026:** the Windows companion is [available on Microsoft Store](https://apps.microsoft.com/detail/9P7VF25K2X1R). [What's new](RELEASE-NOTES.md#microsoft-store-availability--26-september-2026) · [Token-efficiency video and measurement](#token-efficient-context).

## Get started

**[Get it from Microsoft Store](https://apps.microsoft.com/detail/9P7VF25K2X1R)** · [Browser extension](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-extension.zip) · [Manual Windows ZIP](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-windows-x64.zip) · [Source ZIP](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-source.zip) · [Checksums](SHA256SUMS.txt)

1. Install the companion from Microsoft Store on **Windows 11 x64**, open it from Start and choose **Connect browsers**.
2. Download and extract the separate browser extension. In Chrome or Edge, enable **Developer mode → Load unpacked** and select the extracted folder containing `manifest.json`.
3. Enable your chosen site in ToolBraid, use **Check connection** in the companion and [connect your AI](INSTALL.md#4-connect-your-ai).

**Free · Store companion 0.3.3.0 · Extension 0.3.1.** The Store installs the Windows companion, not the browser extension. The separate **0.3.1 RC1 manual ZIP** remains available and unsigned. See [installation](INSTALL.md), [edition differences](docs/compatibility.md#distribution-and-signing) and [Code signing policy](docs/code-signing.md).

<a id="what-is-toolbraid"></a>

## What it can do

| Area | Capabilities |
| --- | --- |
| Browser & WebMCP | Read pages, navigate tabs, fill forms, scroll, upload granted files and use native tools on compatible sites. |
| Windows & files | Inspect desktop accessibility controls; read, create, move and archive within approved local folders. |
| Visual & media | Screenshots, accessibility handles, configured visual analysis and local FFmpeg editing jobs. |
| Research & memory | Multi-tab evidence, source-linked snapshots, citation bundles and bounded local records. |
| Workflows | Checkpointed missions, reusable demonstrations, shadow replay and scheduled tool calls. |
| Community tools | X mentions, replies, requested posts, media and article drafts, plus other site-aware adapters. |

[Full capabilities and requirements →](docs/capabilities.md) · [How the components connect →](docs/architecture.md)

<a id="choose-your-ai"></a>

## Use the AI you already work with

- **Existing Codex session or another MCP client:** keep chatting and choosing models in that client.
- **Optional panel chat:** sign in to Codex with your ChatGPT account. Your Codex allowance applies; no API key for this route.
- **Local models:** use a tool-capable model in an external MCP host. The panel is not a universal provider or local-model selector.

Ask an assistant with tools on your Windows PC to help set it up:

> Install and configure ToolBraid Companion using https://toolbraid.pages.dev/agent-setup.txt. Check my existing installation, verify the official download's SHA-256, preserve other MCP settings, and finish with a read-only connection test.

[Copy the complete setup prompt](https://toolbraid.pages.dev/#ai-setup) · [Manual setup](INSTALL.md). Browser permissions and account sign-in may still need you.

<p align="center"><img src="assets/toolbraid-cover.png" width="860" alt="ToolBraid — From intent to evidence. Cyan and pink strands connect across a dark background."></p>

<a id="watch-the-real-windows-demo"></a>

## Real Windows demo

https://github.com/user-attachments/assets/5696a89b-59d6-4fd8-ad80-023f04fb16b7

Real pages and model responses, an X reply draft, and browser navigation. **1:23 · No audio.** Edited for pace; no live X post in the recording.

[Website player and video description](https://toolbraid.pages.dev/#demo) · [4K export](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-Windows-real-demo-4K.mp4)

## Token-efficient context

https://github.com/user-attachments/assets/418616cf-2b0f-4198-a9f6-327bfb9d27d3

**The same seven public X posts: 821 tokens with ToolBraid Companion versus 5,094 in a full browser DOM snapshot.** 83.9% less returned context, preserving the messages, authors and links. A custom browser extraction returned 661 tokens; this is one measured sample, not a claim about total usage or every workflow. **15 seconds · 1080p · Sound effects, no voice.**

[Measurement and video description](docs/token-efficiency.md) · [Watch on the website](https://toolbraid.pages.dev/#token-efficiency)

<a id="see-the-interface"></a>

## The interface

<table>
  <tr><th width="50%">Optional agent chat</th><th width="50%">Community & site tools</th></tr>
  <tr>
    <td width="50%" valign="top"><a href="assets/chat-subscription-hd.png"><img src="assets/chat-subscription-hd.png" width="480" alt="ToolBraid agent chat — offline UI preview; select to enlarge."></a></td>
    <td width="50%" valign="top"><a href="assets/x-direct-control-hd.png"><img src="assets/x-direct-control-hd.png" width="480" alt="ToolBraid community and WebMCP controls — offline UI preview; select to enlarge."></a></td>
  </tr>
</table>

<a id="browser-support"></a>
<a id="microsoft-store-companion--in-preparation"></a>
<a id="microsoft-store-companion--in-certification"></a>
<a id="control-and-data-boundaries"></a>
<a id="release-status"></a>

## Documentation

- [Installation, AI connections and troubleshooting](INSTALL.md)
- [Compatibility, permissions and recorded validation](docs/compatibility.md)
- [Release history](RELEASE-NOTES.md) · [Data handling](https://toolbraid.pages.dev/privacy/)

## Develop

Requires Node.js 24 LTS. The runtime and unit tests use Node built-ins; no dependency installation is needed for these commands.

```sh
git clone https://github.com/Maharajahu/ToolBraid-Companion.git
cd ToolBraid-Companion
npm run validate
```

Load `dist/toolbraid-extension` in Chrome or Edge. Windows packaging, optional browser integration tests and the source layout are covered in the [development guide](docs/development.md). See [contributing](CONTRIBUTING.md) for changes and regression tests.

## Feedback and support

[Report a bug or suggest a feature](https://github.com/Maharajahu/ToolBraid-Companion/issues/new/choose). Issues are public; use the [Feedback form](https://toolbraid.pages.dev/feedback/) for non-public contact and [security reports](.github/SECURITY.md). Never include credentials or private page content. Source and documentation pull requests are welcome; CI checks the public identity, unit tests, extension build and documentation.

Built by [Maharajahu](https://github.com/Maharajahu). [Apache 2.0](LICENSE); bundled Node.js licensing is included in the Windows package. Donations are optional and unlock no features.
