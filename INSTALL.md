# Install ToolBraid on Windows

These instructions cover the **0.3.0 release candidate**. Microsoft Edge Add-ons is the planned store channel, but no store listing or store extension ID has been issued for this release yet. Chrome uses manual unpacked installation.

## 1. Download and extract

Download `ToolBraid-0.3.0-windows-x64.zip` and `SHA256SUMS.txt` from the same [official release](https://github.com/Maharajahu/toolbraid-releases/releases). Use the release's Assets section, not GitHub's Source code archive.

You can compare the ZIP's SHA-256 hash with the matching entry in the checksum file:

```powershell
Get-FileHash -LiteralPath '.\ToolBraid-0.3.0-windows-x64.zip' -Algorithm SHA256
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

The unpacked extension has a fixed ID derived from its bundled public key. An eventual Edge store ID may differ. Store installation will require an updated companion registration using that actual ID; the current unpacked setup must not be assumed to match it.

## 4. Connect your AI client

### Integrated chat — your ChatGPT subscription

Install a current Codex CLI or the Codex desktop app on this Windows PC. Enable ToolBraid using the steps below, then open **Your browser agent → Connection & model**. Choose **Sign in with ChatGPT** to open the official OpenAI sign-in page, or **Connect to Codex** if already signed in. The panel never asks for your password or API key. API-key-only accounts are rejected. Use your own ChatGPT account with Codex access; its usage limits apply.

You can select an available Codex model or keep the account default. The advanced executable field is only needed if Codex cannot be found in PATH or its Windows desktop installation. If sign-in cannot open, run `codex login` manually and choose ChatGPT sign-in.

Page sharing is off by default for a chat turn. Enable **Share the selected connected page and its tools** when you want browser assistance. The run remains on that tab, even when you switch tabs. Review any mutation's exact arguments before approving. **Stop** cancels new work but does not undo an already-dispatched action. **Clear chat** removes ToolBraid's local conversation copy, not provider-side data.

### External MCP clients — separate from integrated chat

The installer creates `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json`. Add the MCP server configuration from that file to your chosen client.

For Codex, `Configure-Codex.cmd` is optional. It backs up the existing configuration and updates only ToolBraid's MCP entry. Other clients are not configured automatically.

Open the ToolBraid side panel on a test page. Read the direct-control disclosure, tick its consent checkbox, choose **Enable on this site**, and handle the browser's site-access prompt. **Allow advanced tools** requests an additional optional permission. Control remains paused until enabled.

Use **Connect this site** for additional sites. **Pause control** blocks new commands and disconnects the companion; it does not undo actions already dispatched.

Only connect AI clients you trust. Browser results, selected files or desktop information may reach the AI provider configured in that client. Read the packaged `PRIVACY.md` before enabling control.

## First read-only check

In the integrated chat, share your connected test page and ask: “Use the page's read-only tool to read its title. Do not click or submit anything.” You should see activity and a streamed answer. Native WebMCP can be checked separately using **Discover native tools** on a compatible site. An unavailable result means this browser/page does not expose the native API; other browser tools remain usable.

For community monitoring, open X Notifications, Mentions or a specific post conversation in a dedicated tab. Under **Your X community**, inspect it, choose an interval and start watching. Notifications are optional and have no message previews. Keep Edge and the watched tab open. Monitoring does not use a model or post replies; its local inbox only covers rendered content. Pause stops future checks.

After connecting your AI client, open an ordinary public page and enable that site in ToolBraid. Ask your assistant: **“Read this page's title and summarize its visible text. Do not click or submit anything.”** Confirm that the result refers to the intended page before trying actions that change anything.

## Troubleshooting

- **The extension will not load:** select the extracted `extension` folder containing `manifest.json`, not the ZIP or its parent folder. Keep it on disk. An organization-managed browser may prohibit unpacked extensions.
- **The companion is not connected:** confirm that `Install.cmd` completed for the browser you are using and that your AI client uses the generated `mcp-client.json`. The extension and companion must come from the same release. Restart the client connection after changing its configuration.
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
