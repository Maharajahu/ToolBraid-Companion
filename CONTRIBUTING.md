# Contributing

Source fixes, regression tests and documentation corrections are welcome.

1. Open an issue describing the expected behavior and a minimal reproduction. Do not include private page content, account details or credentials.
2. Make a focused branch and add a regression test for behavioral changes.
3. Run `npm run validate`. Use the optional integration checks in the [development guide](docs/development.md) when changing browser or Windows boundaries.
4. Open a pull request explaining what changed, what you tested and what remains unverified.

Keep public access paused by default, preserve exact page/session binding, and never automatically replay a possibly completed mutation. Changes must preserve unrelated MCP configuration and scoped resource grants.

Report vulnerabilities through the [non-public security route](.github/SECURITY.md), not a public issue. Contributions are licensed under [Apache 2.0](LICENSE).
