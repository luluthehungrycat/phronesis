# Phronesis Roadmap

## Product Direction

Phronesis is a standalone product inspired by Hermes Agent and built on OpenCode.

- **OpenCode is the prerequisite runtime.** Phronesis runs OpenCode and extends it; it does not replace OpenCode with an independent agent runtime.
- **Phronesis is its own product.** The plugins are only one layer. The CLI wrapper, profiles, configuration, lifecycle commands, services, documentation, and distribution are part of the product.
- **The CLI is the product boundary.** Implemented Hermes-inspired functionality should be available as `phronesis <subcommand> <arguments>` and should perform the work through OpenCode.
- **Hermes is inspiration and prior art.** Hermes installation, APIs, MCP servers, or other Hermes infrastructure must not be prerequisites for core Phronesis functionality.

## Priority Order

### 1. Make the OpenCode foundation reliable

- Treat the supported OpenCode version and installation as an explicit prerequisite.
- Keep plugin loading, configuration, profiles, session data, and service startup deterministic.
- Verify behavior against the actual OpenCode runtime rather than assuming plugin-level compatibility is sufficient.

### 2. Build the Phronesis CLI wrapper

- Expose implemented capabilities through stable `phronesis` subcommands.
- Preserve familiar Hermes-like command semantics where that improves usability, without copying Hermes infrastructure or making compatibility claims beyond what is implemented.
- Keep command routing, profile selection, configuration, diagnostics, migration, and lifecycle operations in Phronesis.
- Ensure wrapper commands invoke or compose OpenCode consistently and report OpenCode failures clearly.

### 3. Complete and harden capability plugins

Prioritize capabilities that make OpenCode behave more like the intended Phronesis experience:

- skill creation and lifecycle management;
- session search and durable memory;
- persona and user-profile support;
- remote execution with explicit security boundaries;
- gateways and notifications where they provide direct Phronesis value.

Each plugin should remain independently testable, but its user-facing behavior should be documented through the Phronesis CLI where applicable.

### 4. Product quality and distribution

- Make setup, upgrades, profiles, and diagnostics predictable.
- Keep documentation aligned with implemented commands and supported OpenCode versions.
- Maintain integration, container, plugin-compatibility, and CLI tests.
- Document security, data locations, permissions, and failure modes.

## Possible Future Work

### Hermes interoperability (later, optional)

MCP or API interconnectivity with Hermes may be evaluated after the standalone Phronesis/OpenCode path is useful and stable. This work is explicitly downstream of the core product and must not shape current architecture as a required dependency.

Potential future questions include:

- Can Phronesis import or export selected data safely?
- Would an MCP/API bridge provide meaningful value without coupling releases?
- Which boundary preserves independent operation when Hermes is unavailable?

## Non-Goals

- Reimplementing OpenCode as a separate agent runtime.
- Shipping Phronesis as only a bag of OpenCode plugins with no product CLI.
- Making Hermes a required install, service, API, or MCP dependency.
- Prioritizing Hermes interoperability before the native Phronesis CLI and OpenCode integration are reliable.

## Status Tracking

The detailed capability schedule remains in [`docs/02-roadmap.md`](docs/02-roadmap.md). This document is the authoritative statement of product direction and priority; capability status should be kept consistent with the implementation and progress reports.
