# Capabilities

[Overview](../README.md) · [Install](../INSTALL.md) · [Architecture](architecture.md) · [Compatibility](compatibility.md)

Scope: the public **0.3.1 RC1** extension and Windows companion. This is a capability reference, not a promise that every site, application or model supports every operation. Discover the available tools in your connected MCP client; names, schemas and availability depend on the current page, grants and configuration.

## Browser and native WebMCP

- Inspect rendered text, links, forms and actionable controls. Click, type, fill, select, submit and scroll pages or supported nested containers.
- List, open, activate, navigate, reload, go back/forward and close an exact tab. Wait for page readiness or a specific control state.
- Select accessible frames and reset frame context within granted access.
- Discover a compatible site's registered native WebMCP tools and schemas. Execute through a fresh, opaque, one-use handle bound to the page, frame and session.
- Attach user-granted files. List, wait for, cancel or reveal downloads; turn a completed download into a one-use local file grant.
- Return a human handoff for login, verification or rate-limit states. ToolBraid does not bypass CAPTCHA, MFA or site restrictions.

Ordinary browser tools do not need experimental WebMCP flags. Native site tools require both a browser exposing the consumer API and a site registering tools. DOM-based tools remain available when that API is absent.

## Windows and local files

- List visible, enabled desktop windows and inspect their exposed **Windows UI Automation** controls.
- Invoke an exact, freshly revalidated control or set a non-sensitive field value. Applications must expose usable accessibility controls; this is not unrestricted desktop control.
- Issue short-lived, one-use file handles through an owner file picker; revoke unused grants.
- Grant an explicit folder root, then list, read, create, move or archive files inside it. Revoke the root when finished. New writes and moves do not overwrite existing files.

Current bounded file operations: listing depth up to **3**, up to **100 entries**, file reads up to **1 MiB** with chunks up to **256 KiB**, and new writes up to **512 KiB**. A folder grant does not authorize arbitrary paths elsewhere on the machine.

## Visual and media tools

- Capture page screenshots and supported rendered images, video frames or audio for analysis.
- Inspect browser accessibility nodes and activate exact, revalidated handles.
- Analyze visible canvas/custom UI through a separately configured multimodal provider. Coordinate actions are tied to a fresh screenshot, page, session and viewport.
- Run local FFmpeg jobs to trim, concatenate or transcode media, burn subtitles and generate thumbnails. Inspect progress or cancel a job.
- Job schemas support **H.264, H.265, VP9 and AV1**; **MP4, MOV, MKV and WebM** containers; and **PNG, JPEG or WebP** images where applicable.

**FFmpeg is not bundled.** Install/configure it separately; actual formats depend on that build. Optional visual/media analysis also needs its own configured provider and credentials where required. It is not automatically supplied by the panel's ChatGPT subscription connection.

## Research and local memory

- Create bounded multi-tab research workspaces and attach selected tabs.
- Capture page snapshots with source URLs, capture times and evidence fingerprints.
- Build citation bundles, deduplicate evidence and retrieve it in pages for the assistant's response.
- Store, query, export or forget bounded local semantic records with citations and freshness information.
- Explicitly forget retained workspaces and records.

Record search is deterministic lexical retrieval, not vector search or model training. Snapshots represent what was captured, not a continuously updated or complete website archive.

## Workflows, demonstrations and schedules

- Define durable missions with up to **64 exact tool steps**, dependencies and before/after checkpoints. Run, inspect, resume, cancel and clear completed missions.
- Store, list and forget demonstrations with up to **128 semantic steps**.
- Turn demonstrations into versioned declarative adapter drafts; review and explicitly enable or disable them. A generated draft starts disabled.
- Use shadow replay to compare recorded observations without executing the workflow or mutating the page.
- Add one-shot or recurring exact tool calls; list, pause, resume or delete schedules and run due work through the schedule tick tool.

Schedules need an active client/runner to invoke ticks. They are **not an always-on background automation service**. Browser steps also require a connected, enabled extension. Cancellation does not undo already completed changes.

## Community and site-aware adapters

### X developer workflows

Keep in touch with your community without repeatedly leaving your project:

- Inspect rendered mentions and conversation replies with exact post links.
- Ask your assistant what needs attention, prepare a reply, or send the specific response you request.
- Work with posts, replies, likes, reposts, quotes, image/video attachments, media controls and **article drafts**.
- Optionally watch one dedicated notifications or conversation tab. Keep a local inbox and receive count-only notifications without message previews.

Quiet monitoring needs the browser and watched tab open. It does not call a model, spend Codex usage, send replies or read a DM archive. It pauses when access or the watched account/page changes. Coverage is limited to rendered content.

### Other sites

The package includes site-aware adapters for **Google, YouTube, Reddit, Discord, WhatsApp, Telegram, Instagram and TikTok**, alongside general browser tools. These work with rendered pages, not official service APIs. Availability depends on the current view, account eligibility, permissions and site changes. This list is not certification of every operation on those services.

## AI connections

| Route | Where you chat and select the model | Requirements |
| --- | --- | --- |
| External MCP client | Existing Codex session or another local MCP host | A client supporting stdio MCP and its supported model/account route. |
| Optional panel chat | ToolBraid side panel | Current local Codex, ChatGPT sign-in with Codex access; account limits apply, no API key for this route. |
| Local model | External host such as LM Studio | Tool-capable model and MCP-capable host; no ChatGPT account needed. |

No AI model, subscription or API credit is included. The panel has no universal subscription connector or Ollama/LM Studio endpoint selector. [Connection instructions](../INSTALL.md#4-connect-your-ai).

## Permissions and operational limits

The extension starts paused. Enable only intended sites; grant local files and folders deliberately. The integrated chat asks for approval before browser mutations, while external clients use ToolBraid direct-control access and their own approval policies. Pausing prevents new browser commands, not reversal of dispatched work.

Tool results go to the chosen AI client and configured analysis providers. Local transport or a local model does not guarantee all processing stays offline. See [permissions, validation and limitations](compatibility.md) and the [privacy policy](https://toolbraid.pages.dev/privacy/).
