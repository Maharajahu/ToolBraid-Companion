# ToolBraid Abliterated (Chrome MV3)

ToolBraid Abliterated is the private Chrome execution surface for the owner's
local MCP bridge. It exposes the active page as exact-bound tools and provides
native-only tab navigation tools. It has no telemetry, publishing integration,
GitHub/Vercel runtime, automatic model provider, or cloud control plane.

The personal service worker enables Owner Autonomy for authenticated local MCP
requests. Effectful page tools still pass through descriptor, tab, frame,
session, origin, page fingerprint, target fingerprint, nonce, audit and
post-dispatch receipt checks. Authority is never accepted from page content or
from an `approved` field supplied by a model.

Built-in personal capability packs:

- Google account chooser and positive OAuth consent for an already signed-in
  account;
- X compose, publish, reply, like and repost controls;
- TikTok upload caption and publish controls;
- YouTube, Instagram and Reddit visible-content reads, exact-route creation,
  comments/replies and conservative reactions;
- WhatsApp Web, Telegram Web and Discord current-context read, prepare and send;
- generic visible-page controls for other sites.

Accessible frames can be listed and selected, while top-frame canvas controls
can be inspected and clicked through an explicitly configured vision provider
with screenshot and page binding. Multimodal capture includes visible-tab PNG,
media inventory, WebVTT cues, rendered video frames and rendered media audio
through volatile handles. Bounded semantic waits support dynamic pages.

The native/local capability surface also provides:

- completed-download to one-shot upload-grant transfer without returning the
  local path;
- time-limited owner-selected filesystem roots with opaque handles, bounded
  list/read, atomic create-only write, same-root move and archive operations;
- volatile bounded multi-tab research workspaces and citation bundles built
  from canonical page snapshots;
- local-owner-policy-authorized memory with citations, receipts, freshness, lexical
  query, export and explicit forgetting in Chrome local extension storage;
- locally persisted durable missions and one-shot/fixed-interval schedules;
- allowlisted local FFmpeg media jobs whose inputs and outputs remain opaque
  owner-bound FileGrants, plus persisted semantic workflow drafts and read-only
  shadow replay with secret/volatile placeholders;
- exact top-frame accessibility-tree inspection/activation through constrained
  CDP calls, plus a native Windows UI Automation list/invoke/set-value broker
  for visible enabled non-sensitive controls.

Passwords, payment fields and ordinary file inputs are not exposed through the
DOM executor; file inputs use a separate one-shot local grant. CAPTCHA, passkey
and mandatory MFA steps remain explicit owner handoffs, with challenge
detection and post-human validation but no solving or anti-bot evasion.
Optional multimodal analysis uses only the endpoint configured by the owner,
and its key stays in extension session storage.

Research workspaces are lost on extension lifecycle reset, while durable
mission/schedule/workflow state is stored by the native bridge. Schedules are not an OS
background service and run only while the local host, extension and required
page tool are available. Filesystem grants and AX/UIA handles expire; filesystem
operations reject links/junctions, scope escapes and blind overwrite. AX is
top-frame only, and the Windows UIA broker exposes only the generic patterns the
current user's Windows accessibility layer provides. It does not control
elevated or hidden surfaces.

Media jobs require local `ffmpeg`; they do not accept arbitrary flags or shell
commands. Workflow drafts are not executable adapters yet: the implemented
shadow replay compares supplied semantic observations without side effects.

Build with:

```powershell
node scripts/build-universal-extension.mjs
```

Load `dist\toolbraid-abliterated-extension` as an unpacked extension, then run
`scripts\install-mcp-bridge.ps1` to register the local
`com.toolbraid.personal_bridge` native host and copy its required runtime module
graph into the ACL-restricted private install directory. The installer performs
no network request, package installation or deployment.
