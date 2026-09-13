# Build from source

[Overview](../README.md) · [Architecture](architecture.md) · [Contributing](../CONTRIBUTING.md)

This repository contains the public extension, companion runtime and Windows Store app source. Local account configuration, signing credentials, browser profiles and private development history are not needed to build it and are not included.

## Quick build

Use Node.js 24 LTS and Git. The source has no runtime npm dependencies. From a clone or the release's `ToolBraid-0.3.1-source.zip`:

```sh
npm run check
npm test
npm run build:extension
```

The output is `dist/toolbraid-extension`. In Chrome or Edge, use Developer mode → Load unpacked and select that directory. Do not load the source `extension` directory: the builder assembles its shared modules. The public build retains the official unpacked extension identity, starts paused and requires site opt-in.

For a development companion on Windows, run this as your normal user from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-mcp-bridge.ps1 -Edition public -Client None
```

This installs/registers the local native host. Use `-Client Codex` only when you want the helper to configure your Codex MCP entry. It preserves other servers. Follow the [installation guide](../INSTALL.md) for permissions, account connection, updates and removal.

## Windows release packages

On Windows x64, with Windows PowerShell and the .NET Framework C# compiler:

```powershell
npm run package:windows
```

The script downloads or reuses Node.js **24.21.0**, verifies its official SHA-256 and OpenJS signature, builds the public extension and compiles the portable native host. It writes the Windows, extension and keyless Edge submission ZIPs plus their checksums under `dist/release-0.3.1`. No publisher certificate is embedded; the ZIP launcher remains unsigned. ZIP timestamps and local compiler versions can change archive bytes, so a local rebuild need not match the published archive hash byte-for-byte.

For the separate Store app, install the Windows SDK and build the Windows package first, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-store.ps1 -LocalValidation
npm run test:store
```

This produces an **unsigned local-validation MSIX**, not a certified installer. Store publishing requires the publisher's own Partner Center identity and approval; GitHub packaging does not update a Microsoft submission.

## Tests and optional integrations

`npm test` runs deterministic unit/integration fixtures. Lower-level session tests explicitly isolate the access gate; `extension-public-access.test.mjs` separately checks public opt-in, paused access, sender checks and persistence. Live desktop, packaged companion and Store launcher checks are opt-in and report skips when their prerequisites are absent.

Browser integration tests additionally require Playwright and Chromium. Install them only when running that suite:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:extension:standard
npm run test:x:fixtures
```

Build the Windows package first. The standard browser harness needs a clean Windows user account without an existing public companion registration; it refuses to overwrite an installed companion. It enables the public edition in an isolated test profile and removes its temporary installation afterwards. X authoring fixtures do not send posts to a live account. The experimental native-WebMCP harness is available as `npm run test:extension:e2e`; it needs a compatible Chromium build/API and is not a promise of default-browser support. Environment overrides include `E2E_CHROME_PATH` and `E2E_PLAYWRIGHT_MODULE`.

Real-site validation is recorded separately in [compatibility and validation](compatibility.md#recorded-validation). Never treat fixture success as authorization to publish, submit forms or use somebody's account.

## Source layout

```text
extension/     Manifest V3 worker, panel, page bridge and browser tools
src/           Shared runtime, policies, persistence and site adapters
bridge/        MCP/native messaging, local file/UIA tools and launcher source
local-agent/   Durable jobs, scheduler, media and workflow modules
store/         Windows Store app and connection diagnostics source
scripts/       Build, install and test entry points
tests/         Automated regression coverage
fixtures/      Synthetic local pages and protocol fixtures
release/       Package entry points, privacy and publisher packaging resources
```

The release includes a dedicated **source ZIP** made from the source commit linked in its release notes. Verify that ZIP against the release's `SHA256SUMS.txt`. Its internal checksum list covers the runtime packages, not its own enclosing archive. The historical RC tag predates source publication, so its automatic GitHub source archives are not this source snapshot; use the named source ZIP or clone the repository.
