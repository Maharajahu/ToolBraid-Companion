# Install ToolBraid Companion

[Overview](README.md) · [Full specs](docs/capabilities.md) · [Compatibility](docs/compatibility.md)

Install the Windows companion from **[Microsoft Store](https://apps.microsoft.com/detail/9P7VF25K2X1R)** on **Windows 11 x64**, then install the browser extension separately. [Follow the Store setup steps](#microsoft-store-companion).

The numbered steps below cover the alternative **0.3.1 manual Windows ZIP**. It includes the companion, Node.js runtime and matching extension. Its launcher is unsigned. Checksums identify bytes, not a trusted publisher signature. Neither edition includes an AI model, subscription, Codex or FFmpeg. Do not disable Windows, browser or organization security controls.

## 1. Download and extract

Download the [Windows package](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1/ToolBraid-0.3.1-windows-x64.zip) and [SHA256SUMS.txt](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1/SHA256SUMS.txt) from the same release. Compare the ZIP hash with its exact filename entry:

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

Use the ordinary [extension ZIP](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1/ToolBraid-0.3.1-extension.zip) if you already have the matching companion. **The `edge-extension.zip` asset is for publisher submission, not unpacked installation.** It omits the stable unpacked key and may receive a different extension identity.

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

1. **Store:** choose **Open MCP configuration** in the companion (`%LOCALAPPDATA%\ToolBraid\store\mcp-client.json`). **Manual ZIP:** open `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json`. Keep this generated configuration private.
2. Merge only `mcpServers.toolbraid` into your client's configuration, preserving other servers and the generated executable/arguments. Use its documented equivalent if it does not use this JSON format.
3. Reload the client's MCP connection once. Confirm ToolBraid exposes tools, then run the read-only check below.

For **Codex with the manual ZIP**, `Configure-Codex.cmd` backs up the existing configuration and updates only ToolBraid's entry. For the Store edition, use **Open MCP configuration** and your client's supported configuration format instead. This configures your external conversation, not panel chat. Do not publish the configuration or expose it as a public HTTP server.

#### Claude Code example

Use Claude Code's [official authentication](https://code.claude.com/docs/en/authentication) with an eligible account. Check whether a `toolbraid` server already exists before adding it. This example uses the **Store edition**; use `public` instead of `store` in the path only for the manual ZIP edition:

```powershell
$toolbraidClient = Get-Content -LiteralPath "$env:LOCALAPPDATA\ToolBraid\store\mcp-client.json" -Raw | ConvertFrom-Json
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

**Store edition:** use Microsoft Store for companion updates. Do not run the manual ZIP installer over it. The unpacked browser extension is separate and must be updated manually.

**Manual ZIP edition:** close the browser connection, extract the new full package and run its installer. Replace the files in the permanently loaded extension folder with the matching extension, then **Reload** it on the browser's extensions page. Preserve the supplied manifest key. Extracting a ZIP elsewhere does not replace a loaded extension or running connector.

The **19 September 2026 manual-release refresh remains version 0.3.1**. Identify it by [SHA256SUMS.txt](SHA256SUMS.txt), not version alone. Its companion fixes are not included in Store 0.3.3.0. Restart an existing MCP connection once after updating. The manual installer preserves its existing token and local data.

## Uninstall

**Store edition:** close the browser connection, choose **Disconnect browsers** in the companion, then uninstall it through Windows Settings. Remove the extension separately. Local data is retained.

**Manual ZIP edition:** close the browser connection and run:

```powershell
& "$env:LOCALAPPDATA\ToolBraid\public\uninstall.ps1"
```

Remove the extension separately in the browser. The uninstaller removes recorded program files, native-host registrations and its MCP entry, but retains settings, tokens, backups and local data. Provider-side records are separate; see [data retention](https://toolbraid.pages.dev/privacy/).

<a id="microsoft-store-companion--in-preparation"></a>
<a id="microsoft-store-companion--in-certification"></a>

## Microsoft Store companion

**[Available on Microsoft Store](https://apps.microsoft.com/detail/9P7VF25K2X1R): companion 0.3.3.0, Windows 11 build 22000 or later, x64.** The browser extension remains a separate installation.

1. Install the companion from the link above. Open **ToolBraid Companion** from Start and choose **Connect browsers**.
2. Download and extract the ordinary [extension ZIP](https://github.com/Maharajahu/ToolBraid-Companion/releases/download/v0.3.1/ToolBraid-0.3.1-extension.zip) into a permanent folder. In `edge://extensions` or `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the folder containing `manifest.json`. Do not use the keyless Edge submission ZIP or install the ZIP edition's companion on top.
3. Open an ordinary public page, open ToolBraid, read the control disclosure and enable that site. Keep the tab open.
4. Select **Check connection** in the companion. Expect **MCP — OK**, **Extension — CONNECTED** and **Selected page — READY**. A paused extension or unselected page is not a working connection.
5. Choose [one AI route](#4-connect-your-ai). For external clients, use **Open MCP configuration** in the Store app and preserve other client settings. No AI account is needed for the companion's connection check.

The Store edition has a native window with **Connect browsers**, **Disconnect browsers**, **Open MCP configuration** and **Check connection**. Its configuration lives under `%LOCALAPPDATA%\ToolBraid\store`, not the ZIP edition's `public` directory. The extension remains a separate installation.

Diagnostics distinguish configuration, MCP handshake, extension connection and selected-page state without sending browser actions or model requests; they do not test AI sign-in. This window is not part of the ZIP installer.

Before removing a Store installation, select **Disconnect browsers**, then uninstall through Windows Settings. Direct uninstall can leave a stale registration; reinstall and disconnect to restore it. Local data is retained. Microsoft signing of an approved MSIX does not sign the independent ZIP/EXE.
