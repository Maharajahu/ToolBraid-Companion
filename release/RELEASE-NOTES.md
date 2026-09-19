# ToolBraid Companion 0.3.1 RC1

## Media upload and reply fixes — 19 September 2026

Version **0.3.1** and release tag **v0.3.1-rc.1** are unchanged.

- Standard Windows Open dialogs work with exact, revalidated control bindings.
- Media upload verification handles pages that clear/remove their file input, without duplicate selection events. Unconfirmed dispatched uploads return an explicit unknown outcome; inspect attachments before retrying.
- Playing-video countdowns on X no longer invalidate unchanged reply actions. Post, recipient, editor and page changes still invalidate them.

**Verified:** 51 targeted checks, including real Chromium/CDP uploads and Windows file selection. A live Edge workflow through ToolBraid confirmed a prepared reply and a ready video attachment; the test draft was cleared without publication. This does not claim every website or X action is verified.

Windows, manual extension, Edge submission and source ZIPs are refreshed. The Edge submission archive remains 0.3.1; Microsoft requires a version increase to replace an already submitted package, so it has not been resubmitted. The ZIP launcher remains unsigned.

Reinstall the complete Windows package and reload its matching unpacked extension. Verify the current release's `SHA256SUMS.txt` before installation.

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
