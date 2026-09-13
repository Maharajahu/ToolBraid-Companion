# Microsoft Store reviewer instructions — ToolBraid Companion 0.3.1

This local draft covers the MSIX companion, not the ZIP installer or Edge extension submission. A `local-validation` package uses a test identity, disables Connect/Disconnect and live diagnostics, and must not be submitted for certification.

## Prerequisites

Use an isolated Windows x64 account. The owner must supply the real Partner Center identity, final MSIX, matching extension and actual Edge Add-ons ID. No publisher credentials or private source access are needed. Use the supported certification/test installation process without bypassing Windows protections or treating a self-signed certificate as publisher trust.

Reserved Windows identity: `Maharajahu.ToolBraidCompanion`, publisher `CN=E4BF216F-08D0-430A-8F4D-729DDA573ADE`, display name `Maharajahu`, Store ID `9P7VF25K2X1R`. The matching Edge draft uses CRX ID `ailfkkdmjppafngmkobpiogoamidipcl` (Edge Store ID `0RDCKG19W71L`). Both are drafts, not live download links; supply reviewer-accessible artifacts before certification.

Microsoft Store distributes the Windows companion; Edge Add-ons distributes the separate Edge extension. Chrome uses the official unpacked ZIP. This app does not install extensions, grant browser permissions or sign in to an AI provider.

## Read-only review flow

1. Open **ToolBraid Companion** from Start. Check the disclosure, status, keyboard navigation and readable layout at normal and enlarged text/DPI settings.
2. Before connecting, select **Check connection**. Browser registration should need attention; MCP/extension checks should remain untested.
3. Select **Connect browsers**. No administrator prompt should be needed. Previous public registrations are saved for restoration; personal ToolBraid is untouched.
4. With the extension closed, run **Check connection**. Runtime/configuration and MCP initialize/ping can pass while the extension waits. Disabled/missing execution aliases must not appear as a working connection.
5. Open `https://example.org/` or another authorized test page. In the extension, read the disclosure and enable this origin. Decline the native site-access prompt first: control must remain paused. Then grant intentionally. The debugger permission is required at extension installation; ordinary status/page reads do not use it. AI-control and site-access checks also govern advanced tools.
6. Repeat **Check connection**. Expect **MCP — OK**, **Extension — CONNECTED** and **Selected page — READY** when bound; **NOT SELECTED** is distinct. Reports must omit URLs/titles, paths, tokens and raw errors. **AI client — NOT TESTED** is intentional: no model request or sign-in check occurs.
7. For an external client, use **Open MCP configuration** and merge only `mcpServers.toolbraid` into its local stdio MCP configuration. Preserve unrelated servers. Request `toolbraid_status` and a read-only page title. Cloud-only connectors cannot launch this local executable directly.
8. Integrated chat is optional. Review it using your own supported ChatGPT account and separate Codex installation. Check that page sharing starts off, a run stays on its selected tab and browser mutations need chat approval. These approvals do not automatically apply to external clients.

This flow requires no post, reply, like, purchase, form submission, upload or personal X account. Test native WebMCP only with a harmless authorized tool; unsupported browsers/pages should report unavailability. X monitoring covers rendered content in an open watched tab and does not automatically post or call a model.

## Restricted capabilities

| Declaration | Purpose |
| --- | --- |
| `runFullTrust` | Run the Win32 window and bundled Node native/MCP processes as the signed-in user, without administrator elevation. |
| `unvirtualizedResources` | Make native-host registrations discoverable by browsers outside the package and share local connection state. |
| Windows 11 exclusions | Limit exceptions to `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.toolbraid.bridge`, `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.toolbraid.bridge` and `%LOCALAPPDATA%\ToolBraid\store`. |
| Windows 10 compatibility | Older supported Windows uses broader registry/filesystem virtualization switches. The implementation still targets only the described keys/data directory. |

Exact extension origins are allowlisted; the local MCP pipe requires a random token. Runtime files stay in the package. Stable `ToolBraidNativeHost.exe` and `ToolBraidMcp.exe` aliases select the installed version of the same launcher; the generated MCP client configuration passes `--mcp`. The manifest contains one visible application, not hidden helper applications. Capability approval remains Microsoft's decision. [Microsoft virtualization guidance](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization).

## Data and lifecycle

Store data lives under `%LOCALAPPDATA%\ToolBraid\store`, separate from the ZIP edition's `public` directory. It includes authentication configuration and local chat/workflow records. Never attach it to feedback. Check connection reports stay in their local window and are not uploaded. Other enabled features may send permitted page/file/desktop results to the configured client/provider; local transport is not local-only AI.

Close browser connections before switching companions. Test an update using the same real package identity: configuration/token should survive, aliases should select the new version and the read-only MCP check should work. Store-installed updates have not yet been verified.

Select **Disconnect browsers** before uninstalling in Windows Settings. Prior registrations are restored only when still owned by this companion; later changes from another installer are preserved. Disconnect cannot undo actions or close an already-running browser connection. Local data is retained. Direct uninstall may leave a registration pointing to an absent alias; reinstall and disconnect to restore it. Remove the extension separately. Provider-side records are unaffected.

## Evidence and outstanding gates

`scripts/test-store.ps1` checks isolated registration/restoration, exact origins, aliases, token preservation and ACLs; diagnostic failures/redaction; and compiled launchers with real Node, native framing and an authenticated MCP pipe. The extension endpoint is a fixture; a test-only reflection harness redirects configuration. Tests do not install a package, activate Store aliases, use a live browser account or verify Windows Settings update/uninstall.

Before submission: real-identity install/alias/browser/update/uninstall testing, native permission dialogs, final Windows screenshots and publisher-confirmed privacy/submission fields. MakeAppx success is not certification or Microsoft signing. [Microsoft submission workflow](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission).

Support: [Feedback form](https://toolbraid.pages.dev/feedback/). Privacy: [Data handling](https://toolbraid.pages.dev/privacy/). Do not disclose an owner's personal email or include credentials in review material.
