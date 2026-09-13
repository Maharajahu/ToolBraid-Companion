# Install ToolBraid Companion

[Overview](README.md) · [Full specs](docs/capabilities.md) · [Compatibility](docs/compatibility.md)

This guide covers **Windows x64, Chrome or Edge, and 0.3.1 RC1**. The Windows package includes the companion, Node.js runtime and matching extension. It does not include an AI model, subscription, Codex or FFmpeg.

The ZIP launcher is unsigned. Checksums identify downloaded bytes, not a trusted publisher signature. Do not disable Windows, browser or organization security controls. [Store availability](#microsoft-store-companion) is a separate distribution route.

## 1. Download and extract

Download the [Windows package](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-windows-x64.zip) and [SHA256SUMS.txt](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/SHA256SUMS.txt) from the same release. Compare the ZIP hash with its exact filename entry:

```powershell
Get-FileHash -LiteralPath '.\ToolBraid-0.3.1-windows-x64.zip' -Algorithm SHA256
```

Use release **Assets**, not GitHub's automatic **Source code** archives. Extract the complete ZIP into a permanent folder and retain the `extension` subfolder while using it unpacked.

## 2. Install the companion

Close an existing ToolBraid browser connection. Run `Install.cmd` as your normal Windows user, **not administrator**. It installs the public edition under `%LOCALAPPDATA%\ToolBraid\public` and registers its native host for Chrome and Edge.

To register only one browser, run `Install.cmd -Browsers Chrome` or `Install.cmd -Browsers Edge` from the extracted folder.

If you already use the Store edition, do not overwrite its browser registration with the ZIP installer. Use the matching edition's configuration.

## 3. Install the extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode** and select **Load unpacked**.
3. Select the extracted `extension` folder containing `manifest.json`, not the ZIP or its parent folder.
4. Read and accept the browser's required-permission prompt if shown. The refreshed extension declares `debugger` at installation/re-enablement; **there is no separate “Allow advanced tools” step**.

Basic page tools do not attach the debugger. Screenshots, browser accessibility inspection and file attachment use it when needed. Site access and ToolBraid's own control opt-in are still required.

Use the ordinary [extension ZIP](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1-rc.1/ToolBraid-0.3.1-extension.zip) if you already have the matching companion. **The `edge-extension.zip` asset is for publisher submission, not unpacked installation.** It omits the stable unpacked key and may receive a different extension identity.

Organization-managed browsers may prohibit unpacked installation. See the [Chrome installation documentation](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked); do not bypass administrator policy.

## 4. Connect your AI

Choose **one** route. Open the panel on an ordinary public page, read the direct-control disclosure, tick its consent checkbox, choose **Enable on this site**, and grant the browser's site access. Use **Connect this site** for another origin. Keep the browser open.

<a id="option-a-chatgpt-in-the-toolbraid-panel"></a>

### A. Optional ChatGPT panel chat

1. Install current [Codex](https://developers.openai.com/codex/cli/) on this Windows PC and sign in with your own ChatGPT account with Codex access.
2. Open **Your browser agent → Connection & model → Sign in with ChatGPT**. Complete the official login. If Codex is already signed in, connect without signing in again.
3. Choose **Connect to Codex**, then an offered **Codex model** or **Account default**.
4. Enable **Share the selected connected page and its tools** when you want browser assistance. Sharing starts off.

This uses your account's Codex allowance, **not an API key or separate model API billing**. Signing in to the ChatGPT website alone does not sign in the local Codex runtime. Other providers' logins are not accepted in this panel. If needed, run `codex login` using ChatGPT sign-in, then reconnect. Do not share authentication files.

You do not need `Configure-Codex.cmd` or a separate MCP entry for panel chat. Review browser mutations before approving. A run stays on its selected tab; stopping cannot undo an action already sent. Clearing local chat does not remove provider-side records.

<a id="option-b-an-external-mcp-client"></a>

### B. Your existing Codex session or another MCP client

Keep the conversation, sign-in and model selection **in your existing client**. It must support local **stdio MCP servers**; a cloud-only chat cannot directly start the companion on your PC.

1. Open the installer-generated `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json` locally.
2. Merge only `mcpServers.toolbraid` into your client's configuration, preserving other servers and the generated executable/arguments. Use its documented equivalent if it does not use this JSON format.
3. Reload the client's MCP connection once. Confirm ToolBraid exposes tools, then run the read-only check below.

For **Codex**, the package's `Configure-Codex.cmd` helper backs up the existing configuration and updates only ToolBraid's entry. This configures your external Codex conversation, not panel chat. Do not publish the generated configuration or expose it as a public HTTP server.

#### Claude Code example

Use Claude Code's [official authentication](https://code.claude.com/docs/en/authentication) with an eligible account. Check whether a `toolbraid` server already exists before adding it. For a new entry, run:

```powershell
$toolbraidClient = Get-Content -LiteralPath "$env:LOCALAPPDATA\ToolBraid\public\mcp-client.json" -Raw | ConvertFrom-Json
$toolbraidServer = $toolbraidClient.mcpServers.toolbraid
$toolbraidArguments = @('mcp', 'add', '--transport', 'stdio', '--scope', 'user', 'toolbraid', '--', $toolbraidServer.command) + @($toolbraidServer.args)
claude @toolbraidArguments
```

Use `/mcp` to inspect the connection and `/status` to check the account/billing route. Follow the client's [MCP documentation](https://code.claude.com/docs/en/mcp), keeping its approvals enabled. A subscription alone does not connect a provider to ToolBraid. This pairing is documented, not end-to-end certified by this release.

<a id="option-c-a-local-model-in-lm-studio"></a>

### C. A local model in an external MCP host

For example, in [LM Studio](https://lmstudio.ai/docs/app/mcp):

1. Load a model that fits your machine and supports tool calling.
2. Open **Program → Install → Edit mcp.json**.
3. Merge the generated `mcpServers.toolbraid` entry, preserving other servers, and enable the integration in the chat.
4. Verify a real read-only ToolBraid tool call and the correct page title.

This is LM Studio's chat, not ToolBraid's panel. No ChatGPT account is needed. There is no need to expose an HTTP model server or enable CORS for this stdio route. Ollama likewise needs an external host supporting both its model tools and MCP; there is no built-in Ollama endpoint or universal model selector.

LM Studio and individual local models are not end-to-end certified by this release. Local inference can stay on your PC, but website actions, other integrations or a configured cloud/media endpoint can still send data out.

## AI-assisted setup

An assistant with local file and terminal tools can follow the [canonical setup instructions](https://toolbraid.pages.dev/agent-setup.txt). [Copy the setup prompt](https://toolbraid.pages.dev/#ai-setup) into your existing session. It checks an existing installation, verifies the download, configures one client and finishes with a read-only test. Browser consent, file selection and account login may require you; a cloud-only chat cannot install local software by itself.

## First read-only check

Ask: **“Read this page's title and summarize its visible text. Do not click or submit anything.”** Check the actual tool activity and intended page title. In panel chat, page sharing must be on.

Test native WebMCP separately with **Discover native tools** on a compatible page. An unavailable native API does not disable ordinary browser tools. [Requirements and limits](docs/compatibility.md#browser-and-client-compatibility).

**Pause control** blocks new browser commands; it cannot undo dispatched actions or guarantee cancellation of existing companion jobs. External clients use direct-control opt-in and their own approval policies, not the panel chat's per-action UI. [Permissions and data handling](docs/compatibility.md#permissions-and-data).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Extension will not load | Select the permanent folder containing `manifest.json`. Check browser policy. |
| Companion disconnected | Install the same release for your browser. Check the edition and generated MCP entry; reconnect once after a configuration change. |
| Repeated old-connector launches | Install the refreshed full package and use its generated configuration. Restart the existing MCP connection once; do not repeatedly reinstall a working connection. |
| Advanced tools unavailable | Reload/re-enable the matching extension and handle its required-permission prompt. Do not search for the removed permission button. |
| Chat account/model error | Confirm local Codex uses ChatGPT sign-in, reconnect to refresh models and check account limits. |
| AI answers without using the page | Enable the intended site and tools in the external client, or turn on selected-page sharing in panel chat. |
| Local model does not call tools | Check the model's tool-use support and the host's MCP integration. Model files alone are not a connection. |

For unresolved problems, use the [issue form](https://github.com/Maharajahu/ToolBraid-Companion/issues/new/choose) or [Feedback form](https://toolbraid.pages.dev/feedback/). Include version, browser and sanitized error text—not tokens, full configuration, browser profiles or private page contents.

## Update

Updates are manual. Close the browser connection, extract the new full package and run its installer. Replace the files in the permanently loaded extension folder with the matching extension, then **Reload** it on the browser's extensions page. Preserve the supplied manifest key. Extracting a ZIP elsewhere does not replace a loaded extension or running connector.

The **13 September 2026 fixes refresh remains version 0.3.1**. Identify it by [SHA256SUMS.txt](SHA256SUMS.txt), not version alone. Restart an existing MCP connection once after updating. The installer preserves its existing token and local data.

## Uninstall

Close the browser connection and run:

```powershell
& "$env:LOCALAPPDATA\ToolBraid\public\uninstall.ps1"
```

Remove the extension separately in the browser. The uninstaller removes recorded program files, native-host registrations and its MCP entry, but retains settings, tokens, backups and local data. Provider-side records are separate; see [data retention](https://toolbraid.pages.dev/privacy/).

<a id="microsoft-store-companion--in-preparation"></a>
<a id="microsoft-store-companion--in-certification"></a>

## Microsoft Store companion

**Last recorded publisher status, 13 September 2026:** Windows Companion 0.3.1.0 was **In certification**; the separate Edge Add-ons extension was **In review**. No verified public Store installation link is listed here. The prepared Store package has not been certified by this project's installed-Store lifecycle tests.

The Store edition has a native window with **Connect browsers**, **Disconnect browsers**, **Open MCP configuration** and **Check connection**. Its configuration lives under `%LOCALAPPDATA%\ToolBraid\store`, not the ZIP edition's `public` directory. The extension remains a separate installation.

Diagnostics distinguish configuration, MCP handshake, extension connection and selected-page state without sending browser actions or model requests; they do not test AI sign-in. This window is not part of the ZIP installer.

Before removing a Store installation, select **Disconnect browsers**, then uninstall through Windows Settings. Direct uninstall can leave a stale registration; reinstall and disconnect to restore it. Local data is retained. Microsoft signing of an approved MSIX does not sign the independent ZIP/EXE.
