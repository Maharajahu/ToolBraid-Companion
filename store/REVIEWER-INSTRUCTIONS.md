# Microsoft Store reviewer instructions — ToolBraid Companion MSIX 0.3.3.0

This packet covers the MSIX companion, not the ZIP installer or Edge extension submission. The extension/runtime version remains 0.3.1. Record the new passing build ID, source commit and unsigned candidate SHA-256 with the submission; do not reuse the previous candidate's evidence. A `local-validation` package uses a test identity, disables Connect/Disconnect and live diagnostics, and must not be submitted for certification.

## Prerequisites

Use an isolated Windows 11 account, build 22000 or later, and the submitted x64 MSIX. No publisher credentials or private source access are needed. Use the supported certification/test installation process without bypassing Windows protections or treating a self-signed certificate as publisher trust.

Reserved Windows identity: `Maharajahu.ToolBraidCompanion`, publisher `CN=E4BF216F-08D0-430A-8F4D-729DDA573ADE`, display name `Maharajahu`, Store ID `9P7VF25K2X1R`. The matching Edge draft uses CRX ID `ailfkkdmjppafngmkobpiogoamidipcl` (Edge Store ID `0RDCKG19W71L`). Both are drafts, not live download links; supply reviewer-accessible artifacts before certification.

Microsoft Store distributes the Windows companion; Edge Add-ons distributes the separate Edge extension. Chrome uses the official unpacked ZIP. This app does not install extensions, grant browser permissions or sign in to an AI provider.

## Read-only review flow

1. Open **ToolBraid Companion** from Start. Select **Connect browsers**. No administrator prompt should be needed. This registers the companion but does **not** enable the extension or grant access to websites.
2. In **Microsoft Edge**, download and extract the [matching public source ZIP](https://github.com/Maharajahu/ToolBraid-Companion/archive/dca9a2ad70b5eaba93c6d4fa457a0020133d2783.zip). Open `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select the archive's **extension** subdirectory containing `manifest.json`. Expect ID `gpjhdlbjfhlaeakphfognpijgmclecmn`; the source key preserves it. The capability-only patch does not change this extension. Do not use the Edge Add-ons upload ZIP for unpacked installation: it omits the key. Chrome may use the same source via `chrome://extensions`. Do not install the ZIP edition's Windows companion over the Store companion.
3. In that same browser, open `https://example.org/`. Open ToolBraid from the browser's Extensions menu. Do not remain on a new tab, `edge://extensions`, `chrome://extensions` or another browser settings page.
4. If the extension says **Paused**, choose **Finish setup** in its top bar. Read the disclosure, tick **I understand and allow this direct AI control.**, then select **Enable on this site**. Approve access to `https://example.org` if the browser asks. If already enabled, use **Connect this site** instead. Installing the extension and registering the companion do not replace this explicit permission step.
5. Keep that test tab open. In the companion select **Check connection**, or **Check again** in an existing results window. Expect **MCP — OK**, **Extension — CONNECTED** and **Selected page — READY** when bound. **NOT SELECTED** means a page still needs connecting. An unavailable extension is **NOT CONNECTED**, with setup instructions at the top; it is not reported as a successful connection.
6. The extension should show the selected page's title and available browser tools. `example.org` needs no native WebMCP implementation. No AI account, API key, model download or ChatGPT sign-in is required for steps 1–6. **AI client — NOT TESTED** is intentional: Check connection sends no model request or sign-in check, and omits page addresses/titles, paths, tokens and raw errors from its report.
7. To test an external AI client separately, use **Open MCP configuration** and merge only `mcpServers.toolbraid` into its local stdio MCP configuration. Preserve unrelated servers. Request `toolbraid_status` and a read-only page title. Cloud-only connectors cannot launch this local executable directly.
8. Integrated chat is optional, not a prerequisite for the browser connection. Review it using your own supported ChatGPT account and separate Codex installation. Check that page sharing starts off, a run stays on its selected tab and browser mutations need chat approval. These approvals do not automatically apply to external clients.

After the successful connection check, test the permission boundary: select **Pause control**, then try enabling again and decline site access if prompted. Without both consent and site access, page control must remain unavailable. The debugger permission is required at extension installation; ordinary status/page reads do not use it. Check keyboard navigation and readable layout at normal and enlarged text/DPI settings. Missing execution aliases, rejected authentication and a disconnected extension must not be presented as successful.

The 15 September 2026 report cited 10.1.2.10, functionality not working or unclear. Its screenshot showed Runtime, Browser registration, Configuration and MCP passing, with the extension paused. This draft clarifies that missing setup step; the screenshot alone does not establish the absence of other runtime faults. Complete the real installed-package flow above before resubmission.

This flow requires no post, reply, like, purchase, form submission, upload or personal X account. Test native WebMCP only with a harmless authorized tool; unsupported browsers/pages should report unavailability. X monitoring covers rendered content in an open watched tab and does not automatically post or call a model.

## Response to 17 September 2026 report: 10.6.3 Capabilities

We request reconsideration for a changed, Windows-11-only package. We removed the legacy declarations rather than repeating the previous request for broad virtualization changes. ToolBraid is a non-game developer utility that connects a separately installed browser extension to local AI clients using the browser's native messaging protocol.

### 1. Exact declarations

The minimum desktop version is now `10.0.22000.0`. `desktop6:RegistryWriteVirtualization` and `desktop6:FileSystemWriteVirtualization` are **absent**, and the unused `desktop6` namespace has been removed. No legacy `disabled` setting is present. The remaining declarations are:

```xml
<virtualization:RegistryWriteVirtualization>
  <virtualization:ExcludedKeys>
    <virtualization:ExcludedKey>HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\com.toolbraid.bridge</virtualization:ExcludedKey>
    <virtualization:ExcludedKey>HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.toolbraid.bridge</virtualization:ExcludedKey>
  </virtualization:ExcludedKeys>
</virtualization:RegistryWriteVirtualization>
<virtualization:FileSystemWriteVirtualization>
  <virtualization:ExcludedDirectories>
    <virtualization:ExcludedDirectory>$(KnownFolder:LocalAppData)\ToolBraid\store</virtualization:ExcludedDirectory>
  </virtualization:ExcludedDirectories>
</virtualization:FileSystemWriteVirtualization>
```

`virtualization` is `http://schemas.microsoft.com/appx/manifest/virtualization/windows10`. Capabilities remain `<rescap:Capability Name="runFullTrust" />` and `<rescap:Capability Name="unvirtualizedResources" />`. The latter is required for the scoped exclusions themselves, not only for the removed broad legacy switches.

### 2. Supported Windows versions

This MSIX requires **Windows 11 build 22000 or later**. Windows 10 cannot install this candidate because of the manifest minimum version. **No supported version requires blanket HKCU or AppData virtualization disabling.** On supported systems, only the two explicit host keys and one application-owned folder above are excluded. The separate ZIP edition is not part of this Store request.

### 3. Business and technical necessity; no legacy approach

There is no legacy fallback in this candidate. Microsoft Edge and Google Chrome run outside the MSIX package. On Windows, they locate a native messaging host through the vendor's `NativeMessagingHosts` Registry entry, whose default value points to a JSON manifest. An MSIX-private registry entry is not discoverable through that browser lookup. If this capability were removed while retaining native messaging, the browser could not discover the registered companion. [Microsoft Edge native messaging registration](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging).

Each excluded key holds only the path to ToolBraid's host manifest. The excluded folder contains that manifest and the local connection/client configuration and application records described below. Runtime executables remain inside the installed package; the manifest points to the stable Store execution alias. We do not request HKLM access, administrator elevation, a service, a wildcard registry subtree, or an exclusion for AppData generally. The purpose is explicit interoperability with the user's chosen browser and AI client, not game data or access to unrelated applications' settings.

The user explicitly selects **Connect browsers**. Only exact extension origins are accepted; the local MCP pipe is authenticated. **Disconnect browsers** restores previous registrations only if ToolBraid still owns them. We disclose that excluded data remains after uninstall and that direct uninstall without disconnect may leave a stale host registration; we do not claim automatic cleanup of those exceptions. See the lifecycle section below.

The new manifest-scope check rejects Windows 10 support, any legacy virtualization switches, extra/wildcard host keys and extra excluded folders. A fresh installed-package E2E run is required for this candidate, including Edge, browser restart/reconnect, pause, disconnect and uninstall. The submission's build ID and SHA-256 identify the exact tested package. We understand that successful functionality testing is separate from Microsoft's capability approval. [Microsoft flexible virtualization documentation](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization).

## Restricted capabilities

| Declaration | Purpose |
| --- | --- |
| `runFullTrust` | Run the Win32 window and bundled Node native/MCP processes as the signed-in user, without administrator elevation. |
| `unvirtualizedResources` | Make native-host registrations discoverable by browsers outside the package and share local connection state. |
| Windows 11 exclusions | Limit exceptions to `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.toolbraid.bridge`, `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.toolbraid.bridge` and `%LOCALAPPDATA%\ToolBraid\store`. |
| Windows 10 / legacy switches | Not supported by this MSIX. Both broad legacy switches are absent. |

Exact extension origins are allowlisted; the local MCP pipe requires a random token. Runtime files stay in the package. Stable `ToolBraidNativeHost.exe` and `ToolBraidMcp.exe` aliases select the installed version of the same launcher; the generated MCP client configuration passes `--mcp`. The manifest contains one visible application, not hidden helper applications. Capability approval remains Microsoft's decision. [Microsoft virtualization guidance](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization).

## Data and lifecycle

Store data lives under `%LOCALAPPDATA%\ToolBraid\store`, separate from the ZIP edition's `public` directory. It includes authentication configuration and local chat/workflow records. Never attach it to feedback. Check connection reports stay in their local window and are not uploaded. Other enabled features may send permitted page/file/desktop results to the configured client/provider; local transport is not local-only AI.

Close browser connections before switching companions. Test an update using the same real package identity: configuration/token should survive, aliases should select the new version and the read-only MCP check should work. Store-installed updates have not yet been verified.

Select **Disconnect browsers** before uninstalling in Windows Settings. Prior registrations are restored only when still owned by this companion; later changes from another installer are preserved. Disconnect cannot undo actions or close an already-running browser connection. Local data is retained. Direct uninstall may leave a registration pointing to an absent alias; reinstall and disconnect to restore it. Remove the extension separately. Provider-side records are unaffected.

## Evidence and outstanding gates

`scripts/test-store.ps1` checks isolated registration/restoration, exact origins, aliases, token preservation and ACLs; diagnostic failures/redaction; and compiled launchers with real Node, native framing and an authenticated MCP pipe. The extension endpoint is a fixture; a test-only reflection harness redirects configuration. Tests do not install a package, activate Store aliases, use a live browser account or verify Windows Settings update/uninstall.

Before submission: real-identity install/alias/browser/update/uninstall testing, native permission dialogs, final Windows screenshots and publisher-confirmed privacy/submission fields. MakeAppx success is not certification or Microsoft signing. [Microsoft submission workflow](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission).

Support: [Feedback form](https://toolbraid.pages.dev/feedback/). Privacy: [Data handling](https://toolbraid.pages.dev/privacy/). Do not disclose an owner's personal email or include credentials in review material.
