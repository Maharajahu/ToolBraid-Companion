# Code signing policy

[Overview](../README.md) · [Downloads](https://github.com/Maharajahu/ToolBraid-Companion/releases) · [Privacy policy](https://toolbraid.pages.dev/privacy/)

## Distribution and trust

The current GitHub Windows ZIP is **unsigned**. A download must not be described as signed until its actual executable has passed signature verification. Microsoft signs the separately distributed [Store companion](https://apps.microsoft.com/detail/9P7VF25K2X1R); that signature does not cover GitHub builds or the browser extension.

The independent release-signing workflow supports [SignPath.io](https://signpath.io/) with certificates provided by [SignPath Foundation](https://signpath.org/), subject to the Foundation's acceptance and an approved release-signing policy. For releases signed through this program: **Free code signing provided by SignPath.io, certificate by SignPath Foundation.** The certificate identifies the Foundation, not Microsoft or a privately held ToolBraid certificate.

## Responsibilities

- Author, reviewer and release approver: [Maharajahu](https://github.com/Maharajahu), the project maintainer.
- External contributions require maintainer review before release.
- GitHub and SignPath accounts used for signing must have multi-factor authentication enabled.
- Every release-signing request requires the maintainer's manual approval in SignPath.

## What is signed

Only the project's own `bridge/ToolBraidNativeHost.exe` is submitted for Authenticode signing. It is built from this public repository on a GitHub-hosted Windows runner, with product name and version restrictions. The bundled Node.js executable keeps its original OpenJS Foundation signature. No third-party executable is re-signed as ToolBraid.

The verification step requires a trusted SignPath Foundation signature, a timestamp and matching product metadata. It compares every other file in the returned ZIP with the unsigned build, then computes a new SHA-256 checksum. The ZIP itself, browser extension, JavaScript and setup scripts do not gain an Authenticode signature from this process. Checksums establish file integrity, not publisher trust.

## Releasing

The [Windows ZIP workflow](../.github/workflows/sign-windows.yml) runs only when manually requested on the official repository's `main` branch. Its default is **build only**, without signing. It does not publish a GitHub release or submit anything to Microsoft Store.

After provider approval, configure the SignPath project with [the artifact configuration](../.signpath/artifact-configuration.xml), verified GitHub build provenance and a release-signing policy requiring manual approval. Keep the API token in the repository secret `SIGNPATH_API_TOKEN`; set `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG` and `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` as repository variables using the actual provisioned values. Never commit a token, certificate private key or account email.

A signing run preserves the unsigned build and returns a separate verified signed artifact. Only that verified ZIP and its new checksum may be promoted to a signed download. Until such a release is published, existing unsigned downloads remain labelled unsigned. A signature does not promise that Windows will suppress every reputation or security warning.

## Privacy

Tool results are shared with the AI client and services the user chooses. The [privacy policy](https://toolbraid.pages.dev/privacy/) describes these connections and local data retention. Signing does not grant additional browser, file or desktop permissions. Report security concerns through the [security policy](../.github/SECURITY.md).
