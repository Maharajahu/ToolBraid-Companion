# ToolBraid Companion 0.3.1 RC1

## Source and runtime refresh — 13 September 2026

The public extension, Windows companion and Store app source, tests and packaging scripts are now available in the [official repository](https://github.com/Maharajahu/ToolBraid-Companion). See the [build guide](https://github.com/Maharajahu/ToolBraid-Companion/blob/main/docs/development.md) or the dedicated `ToolBraid-0.3.1-source.zip` release asset.

- MCP discovery keeps listed tools across content-only updates and performs one exact-name refresh for a cold lookup. It does not remap stale aliases or replay actions.
- Read handles retain exact page/session binding while tolerating content-only changes. Mutations and file attachments remain strict; navigating away rejects old handles.
- Root scrolling tolerates content changes on the same prepared URL. Nested scroll targets remain fingerprint-bound.
- Includes the earlier reconnect/configuration refresh, required debugger permission, X authoring and scoped-file fixes. The extension links to the canonical Companion repository.

Public-source suite: **580 passed, 4 opt-in skipped, 0 failed**. Before export, **77 targeted automated checks** and **12 read-only live X checks** validated the discovery/read/scroll patch. Authorized live replies were confirmed through fresh page reads; automatic account/postcondition matching remains incomplete. Broader media/article coverage remains fixture-based.

Runtime version remains **0.3.1**. Reinstall the complete Windows package, reload its matching extension and reconnect an already-running MCP client once. Check downloads against the current release's `SHA256SUMS.txt`.

The ZIP launcher is **unsigned**. Refreshed GitHub assets do not alter existing Microsoft submissions or confer a signature. Last recorded status on 13 September: Windows Companion **In certification**, Edge Add-ons **In review**.

[Full release history and validation limits](https://github.com/Maharajahu/ToolBraid-Companion/blob/main/RELEASE-NOTES.md) · [Website](https://toolbraid.pages.dev/)
