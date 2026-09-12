# ToolBraid — Official Releases

Connect your AI client to the browser pages you choose, with visible controls for site access and pausing new commands.

This is Maharajahu's public distribution repository for ToolBraid. It contains installation documentation and release downloads, not the private development repository or its history.

[Website](https://toolbraid.pages.dev/) · [Releases](https://github.com/Maharajahu/toolbraid-releases/releases) · [Installation guide](INSTALL.md)

## Distribution channels

| Browser | Distribution |
| --- | --- |
| Microsoft Edge | Microsoft Edge Add-ons is the planned store channel. The listing is not published yet. |
| Google Chrome | Download from GitHub Releases and install manually with Developer mode → Load unpacked. No Chrome Web Store release is planned. |

GitHub Releases is the official download source. Chrome downloads are not one-click store installations and do not receive automatic extension updates. Early testers can also use the unpacked package in Edge while its store listing is being prepared.

## Current release

The initial public package is **0.2.0 release candidate**. It is not Microsoft-approved or a completed stable launch. See the [release notes](RELEASE-NOTES.md) for completed checks and outstanding validation.

Download assets from a release's **Assets** section:

- `ToolBraid-0.2.0-windows-x64.zip`: complete Windows companion, bundled Node.js runtime, installer and matching extension. This is the normal download for a new installation.
- `ToolBraid-0.2.0-extension.zip`: extension only; an existing matching Windows companion is still required.
- `SHA256SUMS.txt`: SHA-256 checksums for the two packages.

GitHub's automatically generated **Source code** archives contain this documentation repository, not the ToolBraid application. Do not use them as the installer.

## Requirements and control

- Windows x64, Chrome or Microsoft Edge, and an MCP-compatible AI client.
- No separate Node.js installation, compiler, private source checkout or experimental WebMCP flag is required.
- No AI model, API credit or AI subscription is included. Your chosen AI provider may have its own costs.
- The public extension starts paused. Read its disclosure, enable the chosen site, and grant the browser permissions you accept. Pause blocks new commands, not work already dispatched.
- The companion can expose browser content, local file operations and desktop controls to your configured AI client. Local transport does not mean a cloud AI provider receives no data.

The ToolBraid launcher is currently unsigned. Windows may display an unknown-publisher warning. Do not disable antivirus or browser protections. Checksums identify the downloaded bytes; they are not a publisher signature.

## Privacy, support and license

The [data-handling page](https://toolbraid.pages.dev/privacy/) and packaged `PRIVACY.md` currently describe the release candidate and are marked as drafts pending final publisher review.

For feedback, support or privacy questions, use the [private feedback form](https://toolbraid.pages.dev/feedback/). You can also open an issue in this repository, but issues are public. Do not include tokens, credentials, private page content or personal documents in any report.

ToolBraid is distributed under the [Apache License 2.0](LICENSE). The Windows package also contains the bundled runtime's license at `runtime/LICENSE.node.txt`.
