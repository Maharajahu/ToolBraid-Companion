# ToolBraid Companion for Microsoft Store

This is the Microsoft Store packaging path for the local Windows companion, separate from the Edge Add-ons browser extension. No model or AI subscription is included. Chat inside the extension is optional; you can keep working in Codex or another compatible local MCP client.

## Current status

Latest report, completed 17 September 2026: **Attention needed**, policy **10.6.3 Capabilities**. Microsoft denied the `unvirtualizedResources` request and asked for exact declarations, minimum Windows support and justification of the broad legacy settings. The 0.3.3.0 Store candidate removes both legacy virtualization switches and requires **Windows 11 build 22000 or later**. Only the two exact native-host keys and the ToolBraid Store data folder remain excluded. The restricted capability still needs Microsoft's approval; passing functional tests does not grant that approval. This does not change the separate ZIP edition or extension version 0.3.1.

A file named `local-validation` is an unsigned packaging check with a deliberately non-Store identity. **Do not submit or distribute it as a Microsoft-signed application.** No trusted certificate is created or installed by the build. The real Store package must use the exact identity from Partner Center and pass Microsoft's certification before Microsoft signs it.

### Reserved Microsoft Store identity

Verified in Partner Center on 2026-09-13. **ToolBraid Companion** is reserved under **Maharajahu**; a reserved identity alone is not certification or a Microsoft signature.

- Package/Identity/Name: `Maharajahu.ToolBraidCompanion`
- Package/Identity/Publisher: `CN=E4BF216F-08D0-430A-8F4D-729DDA573ADE`
- Package/Properties/PublisherDisplayName: `Maharajahu`
- Package family name: `Maharajahu.ToolBraidCompanion_f24v1p0f17va4`
- Store ID: `9P7VF25K2X1R`

The matching ToolBraid Edge Add-ons draft was verified on 2026-09-13:

- CRX ID for `-EdgeExtensionId`: `ailfkkdmjppafngmkobpiogoamidipcl`
- Edge Store ID: `0RDCKG19W71L`
- Partner Center product ID: `4ce9f559-d8d5-4a7e-a117-f2b9b1b567c7`

The Edge package passed upload validation, but its listing is not published or certified. Do not substitute the Chrome ID for this CRX ID.

Earlier submissions addressed hidden helper applications and unclear first-run connection setup. This candidate retains one visible companion and one console execution-alias extension with both aliases. They target the same bundled launcher; the generated MCP configuration supplies `--mcp`. The capability correction is based on the 0.3.2.0 candidate at commit `dca9a2ad70b5eaba93c6d4fa457a0020133d2783`. Its previous validation is not proof for the changed manifest: the 0.3.3.0 candidate must pass a new installed-package Edge/Chrome run before submission. The resulting build ID, commit and exact candidate hash belong in the reviewer packet.

## After Store installation

1. Install the public ToolBraid extension separately. Edge uses its eventual Edge Add-ons listing; Chrome uses the matching official ZIP and unpacked installation. The Store companion does not install an extension or grant browser permissions.
2. Open **ToolBraid Companion** from Start. Read the connection disclosure and choose **Connect browsers**. This registers the public native messaging host for the current user in Edge and Chrome, without administrator access. Existing public registrations are saved for restoration; personal ToolBraid is untouched. Close an old browser connection before switching companions.
3. In the same browser, open `https://example.org/`, then open ToolBraid from Extensions. If it says **Paused**, choose **Finish setup**, read the disclosure and tick **I understand and allow this direct AI control.** Select **Enable on this site** and approve that site's access if asked. A new tab or browser settings page cannot be connected. Keep the test tab open, then select **Check connection** (or **Check again**) in the companion. Expect **Extension — CONNECTED** and **Selected page — READY**. No AI sign-in is needed for this check.
4. For integrated ChatGPT chat, follow the [chat setup](https://toolbraid.pages.dev/#setup-chatgpt). For your existing Codex or another MCP client, use **Open MCP configuration** and merge the `toolbraid` entry into that client's existing configuration. Do not replace unrelated entries or expose the local server over public HTTP.

Store connection data is under `%LOCALAPPDATA%\ToolBraid\store`, separate from the downloaded ZIP edition's `public` directory. It includes authentication configuration and local conversation/workflow state; do not publish this directory. Runtime executables stay in the Store-managed package. Stable execution aliases route browser and MCP launches to the installed package version without copying unsigned executables into user storage.

**Disconnect browsers** restores saved registrations only when they still point to this Store companion. It preserves a registration changed by another installer. It does not stop a browser process already running or undo dispatched actions. Close the existing browser connection, disconnect, and then uninstall through Windows Settings. Local connection and conversation data are retained; browser extension storage and provider-side records are separate.

## Check connection

The Store app checks its bundled runtime, exact extension configuration, MCP launcher and extension status. A connected extension without a selected page is reported separately. It sends only MCP initialization, ping and `toolbraid_status`: no browser actions or model requests. Page addresses/titles, tokens, paths and raw errors are omitted. AI sign-in is explicitly **NOT TESTED**. Local-validation builds show a not-installed explanation instead of probing live connections. This window is not part of the ZIP installer.

## Release requirements

- Use the reserved Microsoft Store identity above, confirmed against Partner Center before submission; never invent production values.
- Use the actual Edge Add-ons CRX ID above. Only the matching public Chrome unpacked ID is derived automatically from the release's public key.
- Build the current Windows companion with `scripts/build-release.ps1`, then run `scripts/build-store.ps1` with `-PackageName`, `-Publisher`, `-PublisherDisplayName`, `-EdgeExtensionId`, and `-PackageVersion 0.3.3.0`. `-LocalValidation` instead creates a non-submittable local packaging check.
- Validate install, native messaging, MCP stdio, reconnect, package update, disconnect and uninstall on Windows with the real package identity. Unpackaged tests do not establish Store activation or alias compatibility.
- Justify `runFullTrust` for the Win32/Node companion and `unvirtualizedResources` only for the two exact public native-host keys and the Store data folder. No broad legacy switches or Windows 10 fallback are declared. The expanded response to report 10.6.3 is in `store/REVIEWER-INSTRUCTIONS.md`. Microsoft must still approve these restricted capabilities.
- Complete the prepared listing draft and Store reviewer packet, final screenshots and publisher-confirmed privacy declarations. Source files are `store/LISTING.md` and `store/REVIEWER-INSTRUCTIONS.md`; the build copies them into a separate `submission` folder, not the customer MSIX. Package validation is not policy approval. This build does not submit, publish, sign, create accounts, change certificate trust, disable protections, or accept legal agreements.

Run `scripts/test-store.ps1` for isolated registration/ACL checks, diagnostic redaction/failure tests and compiled native/MCP launcher integration. The latter uses real Node and the authenticated pipe, but a fixture extension and test-only redirected configuration. It does not establish installed package activation, live browser permissions or Store update/uninstall behavior.

Microsoft signs the MSIX distributed through the Store after certification. That signature does **not** turn a separately downloaded ZIP/EXE into a publisher-signed release. [Microsoft signing guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

Support and privacy contact: [Feedback form](https://toolbraid.pages.dev/feedback/). Never send credentials, private page contents or your installed configuration.
