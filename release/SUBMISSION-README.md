# ToolBraid 0.3.1 submission kit

This is a local launch candidate, not a published or store-approved product.

## Files to use

- Upload only `ToolBraid-0.3.1-edge-extension.zip` to Edge Add-ons. It omits the manifest `key` rejected by Microsoft's validator. Keep `ToolBraid-0.3.1-extension.zip` for Chrome's manual/unpacked installation and its stable ID. Do not upload this submission-kit ZIP or the Windows companion ZIP to the extension-package field.
- Use `assets/01-connect-your-ai.jpg` and `assets/02-x-direct-control.jpg` as store screenshots. Use the 440 x 280 promotional tile and the appropriate 128 or 300 pixel store logo.
- `STORE-LISTING.md` contains listing copy, permission explanations and proposed privacy-dashboard categories.
- `PRIVACY.md` is the privacy-policy draft. Its support/privacy contact is the [Feedback form](https://toolbraid.pages.dev/feedback/). Verify the proposed policy before final store publication.
- `REVIEWER-INSTRUCTIONS.md` explains clean installation and review. Insert a working companion download URL and the actual store extension ID before submission.
- `COMPANION-README.md` is the end-user installation guide. The separate `ToolBraid-0.3.1-windows-x64.zip` contains the runnable installer, extension and runtime.
- `RUNTIME-SHA256SUMS.txt` identifies the Chrome, Edge and Windows runtime ZIPs. The companion ZIP is kept beside this kit, not duplicated inside it. The outer `SHA256SUMS.txt` also identifies this kit.

The companion includes the current installation guide and release notes. Use the approved real Windows demo at [toolbraid.pages.dev/#demo](https://toolbraid.pages.dev/#demo); it is separate from the store screenshots.

## Remaining release gates

1. Confirm the publisher name, final privacy policy and stable companion download URL. Use the [Feedback form](https://toolbraid.pages.dev/feedback/) as the public support/privacy contact. The website is [toolbraid.pages.dev](https://toolbraid.pages.dev/), with downloads in the [official releases repository](https://github.com/Maharajahu/ToolBraid-Companion/releases).
2. Complete the store account/identity requirements and create the Edge listing to obtain its actual extension ID. Apply those exact IDs to the companion installation instructions or package configuration.
3. Verify installation/re-enablement with the required debugger permission and native site-access grant/decline dialogs on clean Chrome and Edge installations. The automated harness pregrants only its test origins and preserves the production debugger declaration, so it does not prove native-dialog behavior.
4. Validate live X actions on an account and content authorized for testing before advertising live-site certification. Offline tests cover exact Like/Repost/Quote/Post targets and text, The recorded demo additionally covers real X reading and reply drafting, but no live mutation.
5. Review the privacy statements and dashboard attestations, then authorize the actual submission. The ToolBraid launcher remains unsigned; no signing certificate was available. Hashes are not a publisher signature.

The current automated suite passed 575 tests with two opt-in tests skipped. A real native WebMCP page-tool operation passed in Chromium 151 with its experimental flag. Isolated Chrome and Edge runs passed initial enable, MCP reads, exact form submission, X fixture actions, both restart states and pause blocking. Companion install/update/uninstall was validated separately. These results do not remove the manual gates above or guarantee store acceptance.

The kit includes only the distributable extension runtime and the listed launch assets. Repository history, developer-only files, credentials, browser profiles and test fixtures are excluded. The screenshot's localhost address is an isolated test page.
