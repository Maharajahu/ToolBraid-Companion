# ToolBraid 0.3.1 review instructions

## What to install

Review the extension ZIP separately from the Windows companion ZIP. The companion is required for an AI client to call browser tools; the extension does not include a model, AI account or subscription. Initial supported targets are Chrome and Edge on Windows x64.

Use a clean Windows user account or disposable test machine. Install the companion as the normal user, not as administrator, by extracting the full Windows ZIP and running `Install.cmd`. The included Node.js runtime is verified during packaging. The ToolBraid native launcher is currently unsigned; hashes identify the release but do not establish publisher identity. Do not disable antivirus or browser protections to install it.

For a store-installed extension, configure the companion with that store's actual extension ID. From the extracted package, run the installer script with the exact 32-character ID:

```powershell
.\scripts\install-mcp-bridge.ps1 -Edition public -Client None -Browsers Chrome -ChromeExtensionId <actual-chrome-store-id>
```

For Edge, use `-Browsers Edge -EdgeExtensionId <actual-edge-store-id>`. Do not use the unpacked extension ID for a store-installed build unless they have been confirmed identical.

Configure the reviewer's MCP client with the generated `%LOCALAPPDATA%\ToolBraid\public\mcp-client.json`. `Configure-Codex.cmd` is optional, only for reviewers using Codex; it backs up the existing Codex configuration and changes the ToolBraid entry. No publisher account, credentials or access to the private source repository is needed for the runtime.

## Public onboarding and permission checks

1. Open an HTTPS page that you own or have permission to test. Open the ToolBraid side panel. The initial state must be **Paused**; **Enable on this site** must be disabled until its disclosure checkbox is selected.
2. Select the disclosure checkbox and click **Enable on this site**. The browser must show a native site-access request. Decline it first: control must remain paused. Try again and grant access: the panel should show **Enabled** and connect to the selected page.
3. On another origin, check that it cannot be controlled until that origin has been granted. Use **Connect this site** to grant it explicitly.
4. The browser grants the required debugger permission at installation or re-enablement; Chrome does not support it as optional. Under **Advanced browser tools**, verify the permission status, then test accessibility inspection and file attachment on an authorized page. Base page reads and form tools do not use debugger. Pausing AI control must block advanced dispatch too.
5. Restart the browser and confirm that the enabled choice persists. Click **Pause control**, confirm that new page and desktop commands fail, then restart again and confirm that it stays paused. Pause is not a rollback or a cancellation of already-dispatched jobs.

The automated tests cover the real side-panel checkbox and enable/pause clicks, but their fixture host and debugger permissions are pregranted. The native browser dialogs above still need human validation. Do not treat a successful automated run as proof of these dialogs.

## Core AI workflow

For integrated chat, install current Codex, enable ToolBraid and use **Sign in with ChatGPT**. No reviewer credentials are supplied. Verify that an API-key-only Codex account is rejected. Check a streamed answer, Stop, persistence after reopening the panel, Clear chat and a mutation's exact Approve/Reject controls. The chat's approval policy is separate from external MCP direct control. With page sharing off, no browser tools should be sent to Codex; with it on, changing the active tab must not redirect the run.

On a compatible native WebMCP test page, discover and execute a harmless registered tool. Check the unavailable state in an unsupported browser. For quiet community monitoring, use a dedicated X test tab, baseline its rendered posts and verify deduplication, account-change pause and opt-in generic notifications. Do not treat fixture tests as a live X certification.

Ask the configured AI client to call `toolbraid_status` and then read the connected test page. Ask it to fill and submit a harmless form on your own test site with a unique test value. Verify the value at the receiving site and confirm that exactly one submission occurred. Inspect the ToolBraid action receipt; distinguish dispatch from independently verified success.

For X, use a dedicated account and a post the reviewer is authorized to interact with. Test a uniquely identified text post, Like, Repost and Quote. ToolBraid's verified X actions should not request per-action approval after control is enabled; the AI client can still impose its own policy. Confirm each result from the live site, and do not automatically retry a send whose outcome is uncertain. No live account activity is included in our automated evidence; it uses a fully intercepted local X fixture.

## What data is processed

Read the included privacy policy before enabling control. Browser content, selected media, file data and desktop accessibility data can be returned to the configured AI client, and can reach its cloud provider. Optional media analysis uses a user-configured endpoint. Native messaging and the authenticated local pipe are local transport, not a guarantee that the chosen AI model is local.

There is no bundled ToolBraid analytics or advertising endpoint. Browser permissions, local runtime records, user-selected AI providers and the companion's file/desktop tools are described in `PRIVACY.md` and `COMPANION-README.md`.

## Remove the test installation

Close the ToolBraid connection and run `%LOCALAPPDATA%\ToolBraid\public\uninstall.ps1`. It removes recorded program files, native-host registrations and its own MCP entry, while preserving local settings, tokens, backups and data. Remove the extension through the browser. Any retained companion data can be removed separately after the reviewer confirms it is no longer needed.

## Before these notes are sent to a store

Public support/privacy contact: [Feedback form](https://toolbraid.pages.dev/feedback/).

Supply the public companion download URL and public privacy-policy URL, and replace the placeholder store ID in any reviewer-specific command. These notes do not claim store certification, live X validation or native-dialog validation that has not actually happened.
