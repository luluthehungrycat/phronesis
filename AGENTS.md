# Agent Instructions for Phronesis

## Product Context

Phronesis is a standalone product built on OpenCode and inspired by Hermes Agent.

- OpenCode is the required runtime foundation and execution engine.
- Phronesis plugins extend OpenCode, but Phronesis is not merely a plugin collection.
- The Phronesis CLI is the product interface: implemented capabilities should be exposed as `phronesis <subcommand> <arguments>` and executed through OpenCode.
- Hermes is prior art and a behavioral reference, not a runtime dependency.
- Hermes MCP/API interoperability is optional future work, not a current prerequisite or priority.

Read [`ROADMAP.md`](ROADMAP.md) before making architectural or prioritization decisions.

## Implementation Rules

1. Prefer the Phronesis wrapper and native OpenCode integration over direct coupling to Hermes.
2. Do not add Hermes as a required dependency, service, API, or MCP server for core functionality.
3. When adding a capability, decide explicitly whether it belongs in the CLI wrapper, an OpenCode plugin, or both; document the user-facing `phronesis` command when applicable.
4. Keep OpenCode-specific behavior behind the existing wrapper/plugin boundaries so the product can report runtime failures clearly and remain testable.
5. Preserve independent plugin operation, but verify the integrated path through the actual Phronesis CLI and OpenCode runtime.
6. Keep documentation, command specifications, roadmap status, and tests synchronized with implementation. Avoid describing planned Hermes compatibility as implemented functionality.
7. Treat credentials, profile data, session databases, and gateway configuration as sensitive. Never commit secrets or include them in logs, fixtures, or documentation examples.

## Verification Expectations

For changes affecting behavior:

- run the narrowest relevant unit/plugin tests;
- run CLI or integration coverage when wrapper behavior changes;
- distinguish plugin import/build success from actual OpenCode runtime success;
- report confirmed results separately from assumptions or unavailable environment checks.
