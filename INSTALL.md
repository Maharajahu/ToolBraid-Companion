# Install ToolBraid on Windows

These instructions cover the **0.3.1 release candidate**. Microsoft Edge Add-ons is the planned extension store channel; its product identity exists but the extension is not published yet. Chrome uses manual unpacked installation.

<a id="microsoft-store-companion--in-preparation"></a>

## Microsoft Store companion — in certification

ToolBraid Companion 0.3.1.0 was submitted on 13 September 2026 and Partner Center confirmed **In certification**, with free publication after approval. This is a separate route for the Windows companion, not an Edge Add-ons installation, and it is **not available from Microsoft Store yet**. The Store identity and actual Edge extension ID are assigned. Store-installed lifecycle testing is not claimed. An unsigned `local-validation` MSIX is a packaging check, not a trusted installer. The ZIP instructions below remain the manual route.

Once the final Store package is available: install the matching extension separately, open **ToolBraid Companion**, choose **Connect browsers**, and explicitly enable a test site in the extension. **Check connection** checks runtime/configuration, MCP initialize/ping and extension status. **NOT SELECTED** means the extension answered but no page is bound; **WAITING** means no working extension connection was established. It sends no browser action or model request, hides URLs/titles and credentials, and does not test AI sign-in. The ZIP edition does not include this window.

For external clients, use **Open MCP configuration**, under `%LOCALAPPDATA%\ToolBraid\store`, instead of the ZIP edition's `public` path and helper scripts below. Merge only its `toolbraid` entry. Built-in chat remains optional and needs no separate MCP entry. Do not run the ZIP installer over the Store registration unless deliberately switching companions.

Close browser connections and select **Disconnect browsers** before uninstalling the Store app in Windows Settings. Previous public registrations are restored only if still owned by this companion; local connection/chat data is retained. Direct uninstall can leave a stale registration; reinstall and disconnect to restore it. Remove the extension separately. Store signing will not sign the independent ZIP/EXE.

## 1. Download and extract

Download `ToolBraid-0.3.1-windows-x64.zip` and `SHA256SUMS.txt` from the same [official release](https://github.com/Maharajahu/toolbraid-releases/releases). Use the release's Assets section, not GitHub's Source code archive.

You can compare the ZIP's SHA-256 hash with the matching entry in the checksum file:

```powershell
Get-FileHash -LiteralPath '.\ToolBraid-0.3.1-windows-x64.zip' -Algorithm SHA256
```

Extract the complete ZIP into a permanent folder. Keep the `extension` subfolder in place while using an unpacked installation. No separate Node.js installation is needed.

## 2. Install the companion

Close any existing ToolBraid browser connection. Run `Install.cmd` as your normal Windows user, not as administrator. It installs the public companion and registers its native host for both Chrome and Edge.

To register **only Chrome**, open a terminal in the extracted folder and run:

```powershell
.\Install.cmd -Browsers Chrome
```

For **Edge unpacked testing only**:

```powershell
.\Install.cmd -Browsers Edge
```

The launcher is unsigned; an unknown-publisher warning is possible. Do not disable Windows or browser protections.

## 3. Install the extension

### Google Chrome — manual installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the extracted package's `extension` folder, which contains `manifest.json`.
4. Keep that folder on disk. Loading the ZIP itself will not install the extension.

This is the [Chrome-documented unpacked installation flow](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), not a Chrome Web Store installation. Organization-managed browsers may disallow developer-mode extensions; do not change administrator policies to bypass that restriction.

### Microsoft Edge — store release pending

The official Edge Add-ons link will be added after publication. Until then, early testers can open `edge://extensions`, enable Developer mode and load the same `extension` folder unpacked.

The Chrome/unpacked extension ID is `gpjhdlbjfhlaeakphfognpijgmclecmn`. The assigned Edge Add-ons ID is `ailfkkdmjppafngmkobpiogoamidipcl`; it is included in the submitted Store companion's allowlist. Use the ordinary extension folder for unpacked testing, not the keyless Edge submission ZIP. Do not assume an old ZIP companion registration accepts the Store extension ID.

## 4. Connect your AI client

**The built-in chat is optional. Choose one route; you do not need to configure all three.** A ChatGPT account and Codex installation are needed only for Option A. Options B and C keep the conversation and model selection in your external client.

Before any route, open the ToolBraid panel on a test page, read the direct-control disclosure, tick its consent checkbox, choose **Enable on this site**, and handle the browser's site-access prompt. **Allow advanced tools** is a separate optional permission. Use **Connect this site** for additional sites. Keep the browser open and the companion connected.

### Option A: ChatGPT in the ToolBraid panel

1. Install a current [Codex CLI](https://developers.openai.com/codex/cli/) or Codex desktop app on this Windows PC. ToolBraid's bundled Node.js is for its companion; it does not install Codex or include an AI subscription.
2. Open **Your browser agent → Connection & model → Sign in with ChatGPT**. Complete the official OpenAI login in your browser using your own account with Codex access. Already signed in to Codex? Skip login and connect. Being signed in to the ChatGPT website alone is not the same as signing in to the local Codex runtime.
3. Choose **Connect to Codex**. The panel loads the models available to your account. Choose one in **Codex model**, or leave the field blank for **Account default**. This selector is not an arbitrary provider or local-model selector.
4. For browser assistance, select **Share the selected connected page and its tools**. It starts off; without it, chat has no ToolBraid page tools. Ask for the read-only check below and verify the actual tool activity and page title.

This route uses your ChatGPT account's Codex allowance, not a separately billed API key. ToolBraid rejects API-key-only accounts and does not accept Claude, Gemini or other providers' logins in this panel. The official [authentication guide](https://learn.chatgpt.com/docs/auth) explains the difference between subscription and API access. Account limits and model availability still apply.

If sign-in cannot open, run `codex login` yourself and use ChatGPT sign-in, then reconnect. `codex login status` can help confirm the active login method. Do not paste passwords, browser cookies, login tokens or authentication files into ToolBraid or support reports. The advanced executable field is needed only when Codex is not found automatically.

You do **not** need `Configure-Codex.cmd`, a separate MCP entry or a model API key for this built-in route. The run stays on its selected tab. Review each mutation before approving; **Stop** cancels new work but cannot undo an action already sent. **Clear chat** removes ToolBraid's recent local conversation copy, not provider-side records.

### Option B: An external MCP client

Use this route to keep working in your existing assistant, including a provider-supported subscription client. Sign in and choose the model **in that client**, not in ToolBraid. A paid chatbot subscription is not automatically an API key or a license for any third-party integration. Confirm that the chosen provider/client supports your account and **local stdio MCP servers**; a cloud-only connector cannot directly launch a program on your Windows PC.

1. The companion installer generates `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json`. Open this file locally; it contains an `mcpServers.toolbraid` entry with the installed executable and arguments.
2. In a client that uses an `mcpServers` JSON object, merge **only the `toolbraid` entry** into that object's existing entries. Preserve other servers and the generated paths/arguments. Clients with different configuration formats need their documented equivalent. Do not copy an example from another person's PC.
3. Reload the client's MCP connections and check that ToolBraid appears with tools available. Select your model in that client's model picker and run the read-only check below.

The generated entry points to the companion's private local configuration; it is not your AI provider's login. Do not publish your installed configuration or change its paths into a public HTTP endpoint.

**Codex as an external client:** `Configure-Codex.cmd` is an optional helper that backs up the existing configuration and updates only ToolBraid's MCP entry. This configures the Codex app/CLI conversation, not the extension's built-in chat. Other clients are not configured automatically.

#### Example: your Claude subscription through Claude Code

Install Claude Code using its [official setup and authentication instructions](https://code.claude.com/docs/en/authentication), and sign in there with an account that includes Claude Code. This is not an embedded Claude chat in ToolBraid. To register the generated local server, run the following in PowerShell on the same PC:

```powershell
$toolbraidClient = Get-Content -LiteralPath "$env:LOCALAPPDATA\ToolBraid\public\mcp-client.json" -Raw | ConvertFrom-Json
$toolbraidServer = $toolbraidClient.mcpServers.toolbraid
$toolbraidArguments = @('mcp', 'add', '--transport', 'stdio', '--scope', 'user', 'toolbraid', '--', $toolbraidServer.command) + @($toolbraidServer.args)
claude @toolbraidArguments
```

This adds a user-scoped server in Claude Code; it does not log in or change your subscription. If `toolbraid` already exists, inspect the existing entry rather than adding it again. In a Claude Code session, use `/mcp` to check the connection and `/status` to check which account/billing route is active. Follow the client's [MCP documentation](https://code.claude.com/docs/en/mcp) for permission or configuration issues. Keep its approval controls enabled; do not assume it uses the extension chat's per-action approval UI.

The configuration example follows the provider's documented stdio interface. A real Claude Code + ToolBraid session has **not** been certified by this release's end-to-end tests.

### Option C: A local model in LM Studio

This uses **LM Studio's own chat**, not the chat built into ToolBraid. No ChatGPT account, Codex login or cloud model key is required for this local-model route.

1. Install current [LM Studio](https://lmstudio.ai/docs/app). Download or import a supported model that fits your RAM/VRAM and supports tool use. If it is already on disk, load it rather than downloading another copy.
2. Select and load that model in LM Studio's chat. The model choice, context size and hardware settings belong to LM Studio; entering its model name into ToolBraid's **Codex model** field will not connect it.
3. Open the **Program** sidebar, then **Install → Edit mcp.json**. Merge the generated `mcpServers.toolbraid` entry from `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json` into LM Studio's `mcpServers` object. Preserve existing entries. Save and enable the ToolBraid integration in the chat. See the [official MCP setup](https://lmstudio.ai/docs/app/mcp).
4. Keep ToolBraid enabled on your test page and ask the local model to read its title. Check for a real ToolBraid tool call and the correct title, not just an answer based on the prompt. If tools are listed but not called correctly, check the model's tool-use support and context capacity.

You do not need to expose LM Studio's HTTP server, enable CORS or enter a local API URL in ToolBraid for this desktop-chat/MCP route. Local model inference can stay on your PC, but visited websites and submitted browser actions still use the network. Other enabled integrations or a separately configured media/cloud endpoint can also send data out. Loading a local model is not a blanket offline or privacy guarantee.

**Ollama and other local runtimes:** there is no Ollama endpoint field in ToolBraid 0.3.1's built-in chat. They need an external client that supports both that runtime's tool calling and ToolBraid's local stdio MCP server; configure the model in that client. This release does not provide or certify a one-click Ollama integration.

LM Studio setup is based on its documented MCP interface. This release has **not** end-to-end certified LM Studio or every local model. Start with the read-only check; do not interpret these instructions as a new built-in provider feature.

### Controls shared by all routes

**Pause control** blocks new extension commands and disconnects the companion; it does not undo actions already dispatched. External MCP clients use their own approval policy plus ToolBraid's existing direct-control opt-in. The integrated chat's per-mutation approvals do not automatically apply to external clients. Only connect clients you trust; browser results, selected files and desktop information may reach their configured provider. Read `PRIVACY.md` and the [data-handling page](https://toolbraid.pages.dev/privacy/).

## First read-only check

In the integrated chat, share your connected test page and ask: “Use the page's read-only tool to read its title. Do not click or submit anything.” You should see activity and a streamed answer. Native WebMCP can be checked separately using **Discover native tools** on a compatible site. An unavailable result means this browser/page does not expose the native API; other browser tools remain usable.

For community monitoring, open X Notifications, Mentions or a specific post conversation in a dedicated tab. Under **Your X community**, inspect it, choose an interval and start watching. Notifications are optional and have no message previews. Keep Edge and the watched tab open. Monitoring does not use a model or post replies; its local inbox only covers rendered content. Pause stops future checks.

After connecting your AI client, open an ordinary public page and enable that site in ToolBraid. Ask your assistant: **“Read this page's title and summarize its visible text. Do not click or submit anything.”** Confirm that the result refers to the intended page before trying actions that change anything.

## Troubleshooting

- **The extension will not load:** select the extracted `extension` folder containing `manifest.json`, not the ZIP or its parent folder. Keep it on disk. An organization-managed browser may prohibit unpacked extensions.
- **The companion is not connected:** confirm that `Install.cmd` completed for your browser and that the extension and companion come from the same release. External clients need the generated `mcp-client.json` entry; built-in chat does not. Restart the affected connection after configuration changes.
- **Chat login, account or model error:** confirm Codex is installed and signed in through ChatGPT. Reconnect to refresh available models or leave **Codex model** blank for the account default. API-key accounts and other providers cannot be used in this built-in chat. Check account limits in Codex; ToolBraid does not bypass them.
- **Chat answers without reading the page:** enable the intended site and select **Share the selected connected page and its tools** for built-in chat. In an external client, check that the ToolBraid server and its tools are enabled for that conversation.
- **A local model cannot use tools:** check both the client's MCP connection and the model's tool-calling support. Model files or an Ollama server alone do not connect to ToolBraid. Use the external-client route, not the Codex model field.
- **Tools are paused or a page is unavailable:** open the side panel, read the disclosure and enable the intended site. Grant browser site access; use **Connect this site** for another origin. Do not bypass browser or organization restrictions.
- **Advanced tools are unavailable:** those tools require the separate optional advanced-tools permission. Ordinary page tools do not require that permission.
- **Still stuck:** use the [Feedback form](https://toolbraid.pages.dev/feedback/). Include the release version, browser and exact error, but remove tokens, personal paths and private page content. Do not attach your full configuration or browser profile.

## Update

Updates are manual. Close the browser connection, extract the new full package and rerun its installer. Replace the files in the permanently loaded `extension` folder with the matching new extension files, then click **Reload** on its browser extensions page. Merely extracting a new ZIP elsewhere does not update the extension already loaded by the browser. Preserve the manifest's supplied public key so its unpacked ID stays consistent. The companion installer preserves its existing authentication token and local data; it does not download future updates.

## Uninstall

Close the browser connection and run:

```powershell
& "$env:LOCALAPPDATA\ToolBraid\public\uninstall.ps1"
```

Remove the extension separately through the browser. The companion uninstaller removes recorded program files, native-host registrations and its own MCP entry, but preserves settings, tokens, backups and local data. Data retained by a website or AI provider is separate.
