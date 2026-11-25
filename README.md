> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-runtime-ui

Runtime UI abstractions and reusable interface infrastructure for AttoLang applications.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-runtime-ui](https://github.com/atto-lang/atto-runtime-ui); use `https://github.com/atto-lang/atto-runtime-ui.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Scope

UI integration contracts, rendering/event adapters, and target-specific surface capabilities.

## Compatibility and design

This package is intended to integrate with [AttoLang](https://github.com/atto-lang) while clearly separating portable language behavior from backend- and host-specific features. Document APIs, target restrictions, and security/trust boundaries.

## Development and verification

Refer to checked-in sources and CI workflows for verified build and test commands. Include platform-specific execution tests and publish exact-commit evidence before asserting backend parity or production readiness.

## Project status

This README describes the intended repository scope and does not imply implemented functionality or verified target coverage.

## Related

- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Backend-neutral UI surface and event abstractions, rendering bridge contracts, lifecycle interfaces and portable .atto UI primitives.

**Belongs elsewhere:** OS-specific packaging, windowing and device access belong in atto-platform.desktop/mobile; DOM host adapters in atto-browser.

**Security and portability boundary:** UI-thread ownership, handle/generation fences, input validation, capability limits and no cross-thread unsafe access require executable tests.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

## Legacy migration and verification gates

The historical predecessor was `ores-truffle-oreslang/oreslang-runtime-ui`. This repository is now maintained in `atto-lang`; a similarly named repository or imported history does not by itself establish preservation of the original numeric repository ID, source parity or compiler support. Preserve working legacy `.ores` inputs, old package names and CLI references until compatibility and replacement paths have been verified; new source follows the canonical `.atto` specification.

Portable UI contracts and host adapters belong here; managed deployment and unverified UI-thread guarantees do not. [atto-lang](https://github.com/atto-lang) owns language, tooling and portable examples/libraries; [atto-co](https://github.com/atto-co) owns separately governed hosted deployment, tenant infrastructure, registry, identity and billing. Any further original-ID transfer or managed-product carve-out requires separate owner authorization; no direct legacy-org move to atto-co is authorized by this document.

Before an actual transfer, coordinate with the [migration issue](https://github.com/ores-truffle-oreslang/.github/issues/26) and authorized reviewers; inventory numeric ID, exact HEAD/tree, history, access, branch protections/rulesets, open PRs, packages, releases, CI/runners, secrets, webhooks, apps, Pages, dependencies and rollback ownership. Never disclose or mirror private code without authorization. After transfer, verify ID/tree/history and security controls, then execute exact-head tests before changing consumer references. Empty CI steps are NOT_EXECUTED; host-only checks are not compiled guest evidence.
